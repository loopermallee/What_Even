import { clampContactIndex, CONTACTS, getContactByIndex, getCurrentContactIndex } from './contacts';
import { generateGreeting, generateNoSpeechFallback } from './responseEngine';
import { createScriptedTranscriptTurns, getScriptedScenarioById } from './scriptedScenarios';
import { hasEvenNativeHost } from '../bridge/nativeHost';
import type {
  AudioCaptureStatus,
  AppScreen,
  AppState,
  DevicePageLifecycleState,
  EvenStartupBlockedCode,
  LaunchSource,
  ListeningCaptureState,
  ListeningMode,
  NormalizedInput,
  PersistedResumeState,
  RawEventDebugInfo,
  ReliabilityDebugInfo,
  ResumableGlassesScreen,
  ResponseStatusPhase,
  SpeechWindowState,
  SttStatus,
  ScriptedLineMetadata,
  TranscriptEntry,
  TurnSendMode,
  TurnState,
} from './types';

const DEVICE_PAGE_LIFECYCLE_KEY = 'what-even:device-page-lifecycle';
const TURN_SEND_MODE_KEY = 'what-even:turn-send-mode';
const RESUME_STATE_KEY = 'what-even:resume-state';
const LIVE_AUDIO_OPEN_THRESHOLD = 0.18;
const LIVE_AUDIO_CLOSE_THRESHOLD = 0.08;

type Listener = (state: AppState) => void;

export function clampActionIndex(index: number, maxExclusive: number) {
  if (maxExclusive <= 0) {
    return 0;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= maxExclusive) {
    return maxExclusive - 1;
  }

  return index;
}

function readDevicePageLifecycleState(): DevicePageLifecycleState {
  try {
    const value = localStorage.getItem(DEVICE_PAGE_LIFECYCLE_KEY);
    if (value === 'active' || value === 'inactive' || value === 'unknown') {
      return value;
    }
  } catch {
    // storage may be unavailable in embedded contexts
  }

  return 'unknown';
}

function writeDevicePageLifecycleState(value: DevicePageLifecycleState) {
  try {
    localStorage.setItem(DEVICE_PAGE_LIFECYCLE_KEY, value);
  } catch {
    // storage may be unavailable in embedded contexts
  }
}

function readTurnSendMode(): TurnSendMode {
  try {
    const value = localStorage.getItem(TURN_SEND_MODE_KEY);
    if (value === 'fast' || value === 'review') {
      return value;
    }
  } catch {
    // storage may be unavailable in embedded contexts
  }

  return 'review';
}

function writeTurnSendMode(value: TurnSendMode) {
  try {
    localStorage.setItem(TURN_SEND_MODE_KEY, value);
  } catch {
    // storage may be unavailable in embedded contexts
  }
}

function isResumableGlassesScreen(value: unknown): value is ResumableGlassesScreen {
  return value === 'contacts'
    || value === 'incoming'
    || value === 'listening'
    || value === 'active'
    || value === 'ended';
}

function sanitizeResumeState(value: unknown): PersistedResumeState {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const lastContactIndex = typeof candidate?.lastContactIndex === 'number' && Number.isInteger(candidate.lastContactIndex)
    ? candidate.lastContactIndex
    : null;
  const lastResumableGlassesScreen = isResumableGlassesScreen(candidate?.lastResumableGlassesScreen)
    ? candidate.lastResumableGlassesScreen
    : null;
  const lastListeningMode =
    candidate?.lastListeningMode === 'capture'
    || candidate?.lastListeningMode === 'actions'
    || candidate?.lastListeningMode === 'review'
      ? candidate.lastListeningMode
      : null;
  const autoEnterListenOnGlassesLaunch = typeof candidate?.autoEnterListenOnGlassesLaunch === 'boolean'
    ? candidate.autoEnterListenOnGlassesLaunch
    : true;

  return {
    lastContactIndex,
    lastResumableGlassesScreen,
    lastListeningMode,
    autoEnterListenOnGlassesLaunch,
  };
}

function createDefaultResumeState(): PersistedResumeState {
  return {
    lastContactIndex: null,
    lastResumableGlassesScreen: null,
    lastListeningMode: null,
    autoEnterListenOnGlassesLaunch: true,
  };
}

function readResumeState(): PersistedResumeState {
  try {
    const raw = localStorage.getItem(RESUME_STATE_KEY);
    if (!raw) {
      return createDefaultResumeState();
    }

    return sanitizeResumeState(JSON.parse(raw));
  } catch {
    return createDefaultResumeState();
  }
}

function writeResumeState(value: PersistedResumeState) {
  try {
    localStorage.setItem(RESUME_STATE_KEY, JSON.stringify(value));
  } catch {
    // storage may be unavailable in embedded contexts
  }
}

function createInitialAudioCaptureState(captureSessionStartedAt: number | null = null) {
  return {
    audioCaptureStatus: 'idle' as AudioCaptureStatus,
    micOpen: false,
    audioFrameCount: 0,
    audioBufferByteLength: 0,
    bufferedAudioDurationMs: 0,
    elapsedCaptureDurationMs: 0,
    captureSessionStartedAt,
    lastAudioFrameAt: null as number | null,
    listeningActivityLevel: 0,
    audioError: null as string | null,
  };
}

function createInitialSttState(listeningSessionId: number) {
  return {
    sttStatus: 'idle' as SttStatus,
    sttPartialTranscript: '',
    sttDraftDisplayText: '',
    sttDraftVisibleUntil: null as number | null,
    lastTranscriptAt: null as number | null,
    sttError: null as string | null,
    listeningSessionId,
  };
}

function createInitialTurnState() {
  return {
    turnState: 'idle' as TurnState,
    lastHandledUserTranscriptId: null as number | null,
    pendingResponseId: null as number | null,
    responseError: null as string | null,
    responseStatusPhase: null as ResponseStatusPhase | null,
    responseStatusTimestamp: null as number | null,
  };
}

function createInitialListeningState() {
  return {
    listeningActionIndex: 0,
    listeningMode: 'capture' as ListeningMode,
    listeningCaptureState: 'capturing' as ListeningCaptureState,
    listeningReviewOffset: 0,
  };
}

function createInitialSpeechWindowState(): SpeechWindowState {
  return {
    isOpen: false,
    source: 'none',
    entryId: null,
    role: null,
  };
}

function sameSpeechWindow(left: SpeechWindowState, right: SpeechWindowState) {
  return left.isOpen === right.isOpen
    && left.source === right.source
    && left.entryId === right.entryId
    && left.role === right.role;
}

function createInitialReliabilityState(): ReliabilityDebugInfo {
  return {
    activeSttSessionToken: null,
    activeSttListeningSessionId: null,
    sttReconnectAttemptedSessionId: null,
    sttRetryScheduledForSessionId: null,
    sttRetryScheduledAt: null,
    sttRetryCancelledAt: null,
    lastIgnoredStaleCallback: null,
    lastIgnoredStaleCallbackAt: null,
    lastCleanupReason: null,
    lastCleanupAt: null,
    pendingPartialFlush: false,
    lastErrorCategory: null,
    lastErrorCode: null,
  };
}

function getLatestTranscriptCursor(transcript: TranscriptEntry[]) {
  return transcript.length > 0 ? transcript.length - 1 : -1;
}

function createInitialScriptedState() {
  return {
    scriptedScenarioId: null as string | null,
    scriptedScenarioTitle: null as string | null,
    scriptedLineEntryIds: [] as number[],
    scriptedLineMetadataByEntryId: {} as Record<number, ScriptedLineMetadata>,
    scriptedAutoplay: false,
  };
}

export function createInitialState(): AppState {
  const persistedResumeState = readResumeState();
  return {
    screen: 'contacts',
    screenBeforeDebug: 'contacts',
    started: false,
    simulatorSessionDetected: false,
    evenNativeHostDetected: hasEvenNativeHost(),
    selectedContactIndex: 0,
    engagedContactIndex: null,
    turnSendMode: readTurnSendMode(),
    ...createInitialListeningState(),
    activeActionIndex: 0,
    endedActionIndex: 0,
    dialogueIndex: -1,
    activeTranscriptCursor: -1,
    transcript: [],
    ...createInitialScriptedState(),
    ...createInitialTurnState(),
    deviceLifecycleState: readDevicePageLifecycleState(),
    evenStartupStatus: 'idle',
    evenStartupBlockedCode: null,
    evenStartupBlockedMessage: null,
    lastNormalizedInput: null,
    lastRawEvent: null,
    imageSync: {
      lastPortraitAsset: null,
      lastResult: 'idle',
      lastAt: null,
    },
    reliability: createInitialReliabilityState(),
    ...createInitialAudioCaptureState(),
    ...createInitialSttState(0),
    speechWindow: createInitialSpeechWindowState(),
    logs: [],
    launchSource: 'unknown',
    autoEnterListenOnGlassesLaunch: persistedResumeState.autoEnterListenOnGlassesLaunch,
  };
}

export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private nextTranscriptId: number;
  private nextResponseWorkId = 1;
  private persistedResumeState: PersistedResumeState;

  constructor(initialState: AppState = createInitialState()) {
    this.state = initialState;
    this.nextTranscriptId = this.computeNextTranscriptId(initialState.transcript);
    this.persistedResumeState = readResumeState();
    if (this.persistedResumeState.autoEnterListenOnGlassesLaunch !== initialState.autoEnterListenOnGlassesLaunch) {
      this.state = {
        ...initialState,
        autoEnterListenOnGlassesLaunch: this.persistedResumeState.autoEnterListenOnGlassesLaunch,
      };
    }
  }

  private computeNextTranscriptId(transcript: TranscriptEntry[]) {
    const maxSeen = transcript.reduce((maxId, entry) => Math.max(maxId, entry.id), 0);
    return maxSeen + 1;
  }

  private allocateTranscriptId() {
    const id = this.nextTranscriptId;
    this.nextTranscriptId += 1;
    return id;
  }

  getState() {
    return this.state;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: AppState) {
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private patch(partial: Partial<AppState>) {
    this.setState({
      ...this.state,
      ...partial,
    });
  }

  private persistResumeState(update: Partial<PersistedResumeState>) {
    const nextResumeState = sanitizeResumeState({
      ...this.persistedResumeState,
      ...update,
    });
    const currentSerialized = JSON.stringify(this.persistedResumeState);
    const nextSerialized = JSON.stringify(nextResumeState);
    if (currentSerialized === nextSerialized) {
      return;
    }

    this.persistedResumeState = nextResumeState;
    writeResumeState(nextResumeState);
  }

  private persistResumableScreen(screen: ResumableGlassesScreen | null) {
    this.persistResumeState({
      lastResumableGlassesScreen: screen,
      lastListeningMode: screen === 'listening' ? this.state.listeningMode : this.persistedResumeState.lastListeningMode,
    });
  }

  private clampContactIndex(index: number | null) {
    return clampContactIndex(index);
  }

  private getCurrentContactIndex() {
    return getCurrentContactIndex(this.state);
  }

  private getCurrentContact() {
    return getContactByIndex(this.getCurrentContactIndex());
  }

  private getUsableListeningDraftText() {
    return this.state.sttPartialTranscript.trim() || this.state.sttDraftDisplayText.trim();
  }

  private patchSpeechWindow(nextSpeechWindow: SpeechWindowState) {
    if (sameSpeechWindow(this.state.speechWindow, nextSpeechWindow)) {
      return;
    }

    this.patch({ speechWindow: nextSpeechWindow });
  }

  private clearTurnWorkForBoundary(nextTurnState: TurnState = 'idle') {
    return {
      ...createInitialTurnState(),
      turnState: nextTurnState,
      responseStatusTimestamp: Date.now(),
    };
  }

  private findNewestUnhandledUserEntry() {
    const index = this.findNewestUnhandledUserEntryIndex();
    return index >= 0 ? this.state.transcript[index] : null;
  }

  private findNewestUnhandledUserEntryIndex() {
    const lastHandled = this.state.lastHandledUserTranscriptId;
    for (let index = this.state.transcript.length - 1; index >= 0; index -= 1) {
      const entry = this.state.transcript[index];
      if (entry.role !== 'user') {
        continue;
      }

      if (lastHandled !== null && entry.id <= lastHandled) {
        continue;
      }

      return index;
    }

    return -1;
  }

  private presentTranscriptEntryByIndex(index: number) {
    const entry = this.state.transcript[index] ?? null;
    if (!entry) {
      this.patch({
        activeTranscriptCursor: -1,
        speechWindow: createInitialSpeechWindowState(),
      });
      return;
    }

    const nextSpeechWindow = entry.role === 'contact' || entry.role === 'system'
      ? {
        isOpen: true,
        source: 'scripted_text' as const,
        entryId: entry.id,
        role: entry.role,
      }
      : createInitialSpeechWindowState();

    this.patch({
      activeTranscriptCursor: index,
      speechWindow: nextSpeechWindow,
    });
  }

  private reconcileLiveAudioSpeechWindow(options?: {
    partialText?: string;
    listeningActivityLevel?: number;
    forceClose?: boolean;
  }) {
    if (this.state.screen !== 'listening') {
      if (this.state.speechWindow.source === 'live_audio') {
        this.patchSpeechWindow(createInitialSpeechWindowState());
      }
      return;
    }

    if (options?.forceClose) {
      if (this.state.speechWindow.source === 'live_audio') {
        this.patchSpeechWindow(createInitialSpeechWindowState());
      }
      return;
    }

    const partialText = options?.partialText ?? this.state.sttPartialTranscript;
    const listeningActivityLevel = options?.listeningActivityLevel ?? this.state.listeningActivityLevel;
    const hasPartial = partialText.trim().length > 0;
    const shouldOpen = hasPartial || listeningActivityLevel >= LIVE_AUDIO_OPEN_THRESHOLD;
    const shouldHold = this.state.speechWindow.source === 'live_audio'
      && listeningActivityLevel > LIVE_AUDIO_CLOSE_THRESHOLD;

    if (shouldOpen) {
      this.openLiveAudioSpeechWindow('user');
      return;
    }

    if (!shouldHold && this.state.speechWindow.source === 'live_audio') {
      this.patchSpeechWindow(createInitialSpeechWindowState());
    }
  }

  private appendGeneratedResponseTurns(responseTurns: Array<Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>>) {
    if (responseTurns.length === 0) {
      return this.state.transcript;
    }

    const contactName = this.getCurrentContact().name;
    const timestamp = Date.now();
    const entries: TranscriptEntry[] = responseTurns.map((turn) => ({
      id: this.allocateTranscriptId(),
      role: turn.role,
      speaker: turn.speaker,
      text: turn.text,
      contactName,
      createdAt: timestamp,
      emotion: turn.emotion,
    }));

    return [...this.state.transcript, ...entries];
  }

  private isPendingResponseJobActive(responseJobId: number) {
    return this.state.screen === 'active' && this.state.pendingResponseId === responseJobId;
  }

  private findResponseEntryIndex(responseJobId: number, role: TranscriptEntry['role'] = 'contact') {
    return this.state.transcript.findIndex((entry) => entry.responseJobId === responseJobId && entry.role === role);
  }

  private replaceTranscriptEntryAt(index: number, nextEntry: TranscriptEntry) {
    const transcript = [...this.state.transcript];
    transcript[index] = nextEntry;
    return transcript;
  }

  private removeResponsePlaceholderEntries(responseJobId: number) {
    return this.state.transcript.filter((entry) => entry.responseJobId !== responseJobId);
  }

  private dropActivePendingResponseArtifacts() {
    if (this.state.pendingResponseId === null) {
      return this.state.transcript;
    }

    return this.state.transcript.filter((entry) => {
      if (entry.responseJobId !== this.state.pendingResponseId) {
        return true;
      }

      return entry.streamState === 'complete';
    });
  }

  private buildSpeechWindowForEntry(entry: TranscriptEntry | null) {
    return entry && (entry.role === 'contact' || entry.role === 'system')
      ? {
        isOpen: true,
        source: 'scripted_text' as const,
        entryId: entry.id,
        role: entry.role,
      }
      : createInitialSpeechWindowState();
  }

  log(message: string) {
    const time = new Date().toLocaleTimeString();
    this.patch({ logs: [...this.state.logs, `[${time}] ${message}`] });
  }

  clearLogs() {
    this.patch({ logs: [] });
    this.log('Log cleared.');
  }

  setStarted(started: boolean) {
    this.patch({
      started,
      speechWindow: started ? this.state.speechWindow : createInitialSpeechWindowState(),
    });
  }

  setSimulatorSessionDetected(detected: boolean) {
    this.patch({ simulatorSessionDetected: detected });
  }

  setEvenNativeHostDetected(detected: boolean) {
    this.patch({ evenNativeHostDetected: detected });
  }

  setLaunchSource(launchSource: LaunchSource) {
    if (this.state.launchSource === launchSource) {
      return;
    }

    this.patch({ launchSource });
  }

  setScreen(screen: AppScreen) {
    this.patch({
      screen,
      speechWindow: screen === this.state.screen ? this.state.speechWindow : createInitialSpeechWindowState(),
    });
  }

  enterDebugScreen() {
    if (!import.meta.env.DEV || this.state.screen === 'debug') {
      return;
    }

    this.patch({
      screenBeforeDebug: this.state.screen,
      screen: 'debug',
      speechWindow: createInitialSpeechWindowState(),
    });
  }

  exitDebugScreen() {
    if (this.state.screen !== 'debug') {
      return;
    }

    this.patch({ screen: this.state.screenBeforeDebug });
  }

  setDeviceLifecycleState(value: DevicePageLifecycleState) {
    writeDevicePageLifecycleState(value);
    this.patch({ deviceLifecycleState: value });
  }

  setEvenStartupStarting() {
    this.patch({
      evenStartupStatus: 'starting',
      evenStartupBlockedCode: null,
      evenStartupBlockedMessage: null,
    });
  }

  setEvenStartupReady() {
    this.patch({
      evenStartupStatus: 'ready',
      evenStartupBlockedCode: null,
      evenStartupBlockedMessage: null,
    });
  }

  setEvenStartupBlocked(code: EvenStartupBlockedCode, message: string) {
    this.patch({
      evenStartupStatus: 'blocked',
      evenStartupBlockedCode: code,
      evenStartupBlockedMessage: message,
    });
  }

  clearEvenStartupBlocked() {
    this.patch({
      evenStartupBlockedCode: null,
      evenStartupBlockedMessage: null,
    });
  }

  setSelectedContactIndex(index: number) {
    const normalized = this.clampContactIndex(index);
    if (normalized === this.state.selectedContactIndex) {
      this.persistResumeState({ lastContactIndex: normalized });
      return;
    }

    this.patch({
      selectedContactIndex: normalized,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      speechWindow: createInitialSpeechWindowState(),
      ...createInitialListeningState(),
      ...createInitialScriptedState(),
      ...this.clearTurnWorkForBoundary('idle'),
    });
    this.persistResumeState({ lastContactIndex: normalized });
  }

  moveContactSelection(direction: -1 | 1) {
    this.setSelectedContactIndex(this.state.selectedContactIndex + direction);
  }

  setTurnSendMode(mode: TurnSendMode) {
    if (this.state.turnSendMode === mode) {
      return;
    }

    writeTurnSendMode(mode);
    this.patch({
      turnSendMode: mode,
    });
  }

  setActiveActionIndex(index: number) {
    this.patch({ activeActionIndex: clampActionIndex(index, 2) });
  }

  setListeningActionIndex(index: number) {
    this.patch({ listeningActionIndex: clampActionIndex(index, 3) });
  }

  setListeningMode(mode: ListeningMode) {
    if (this.state.listeningMode === mode) {
      return;
    }

    this.patch({
      listeningMode: mode,
      listeningCaptureState: mode === 'capture' ? this.state.listeningCaptureState : 'paused',
      listeningReviewOffset: mode === 'review' ? this.state.listeningReviewOffset : 0,
      listeningActionIndex: mode === 'actions' ? clampActionIndex(this.state.listeningActionIndex, 3) : 0,
    });
    this.persistResumeState({ lastListeningMode: mode });
  }

  setListeningCaptureState(captureState: ListeningCaptureState) {
    if (this.state.listeningCaptureState === captureState) {
      return;
    }

    this.patch({
      listeningCaptureState: captureState,
      listeningActionIndex: captureState === 'paused'
        ? clampActionIndex(this.state.listeningActionIndex, 3)
        : 0,
    });
  }

  enterListeningReviewMode() {
    if (this.state.screen !== 'listening') {
      return;
    }

    this.patch({
      listeningMode: 'review',
      listeningReviewOffset: 0,
    });
  }

  exitListeningReviewMode() {
    if (this.state.screen !== 'listening') {
      return;
    }

    this.patch({
      listeningMode: 'actions',
      listeningReviewOffset: 0,
    });
  }

  moveListeningReviewOffset(direction: -1 | 1) {
    if (this.state.screen !== 'listening' || this.state.listeningMode !== 'review') {
      return;
    }

    this.patch({
      listeningReviewOffset: Math.max(0, this.state.listeningReviewOffset + direction),
    });
  }

  setEndedActionIndex(index: number) {
    this.patch({ endedActionIndex: clampActionIndex(index, 2) });
  }

  getPersistedResumeState() {
    this.persistedResumeState = readResumeState();
    return this.persistedResumeState;
  }

  setAutoEnterListenOnGlassesLaunch(enabled: boolean) {
    if (this.state.autoEnterListenOnGlassesLaunch === enabled) {
      return;
    }

    this.patch({ autoEnterListenOnGlassesLaunch: enabled });
    this.persistResumeState({ autoEnterListenOnGlassesLaunch: enabled });
  }

  restoreSafeLaunchResume(options: {
    contactIndex: number | null;
    screen: ResumableGlassesScreen;
    listeningMode: ListeningMode | null;
  }) {
    const selectedContactIndex = this.clampContactIndex(options.contactIndex);
    const restoredListeningMode = options.listeningMode ?? this.persistedResumeState.lastListeningMode ?? 'capture';
    const safeListeningMode: ListeningMode =
      restoredListeningMode === 'actions' || restoredListeningMode === 'review' || restoredListeningMode === 'capture'
        ? restoredListeningMode
        : 'capture';

    const basePatch: Partial<AppState> = {
      selectedContactIndex,
      engagedContactIndex: options.screen === 'contacts' ? null : selectedContactIndex,
      speechWindow: createInitialSpeechWindowState(),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialScriptedState(),
    };

    if (options.screen === 'contacts') {
      this.patch({
        ...basePatch,
        screen: 'contacts',
        ...createInitialListeningState(),
        activeActionIndex: 0,
        endedActionIndex: 0,
        dialogueIndex: -1,
        activeTranscriptCursor: -1,
        transcript: [],
      });
    } else if (options.screen === 'incoming') {
      this.patch({
        ...basePatch,
        screen: 'incoming',
        ...createInitialListeningState(),
        activeActionIndex: 0,
        endedActionIndex: 0,
        dialogueIndex: -1,
        activeTranscriptCursor: -1,
        transcript: [],
      });
    } else if (options.screen === 'listening') {
      this.patch({
        ...basePatch,
        screen: 'listening',
        transcript: [],
        listeningMode: safeListeningMode,
        listeningCaptureState: safeListeningMode === 'capture' ? 'capturing' : 'paused',
        listeningActionIndex: 0,
        listeningReviewOffset: 0,
        activeActionIndex: 0,
        endedActionIndex: 0,
        dialogueIndex: -1,
        activeTranscriptCursor: -1,
      });
    } else if (options.screen === 'active') {
      this.patch({
        ...basePatch,
        screen: 'active',
        transcript: [],
        ...createInitialListeningState(),
        activeActionIndex: 0,
        endedActionIndex: 0,
        dialogueIndex: -1,
        activeTranscriptCursor: -1,
        responseStatusPhase: 'standby',
        responseStatusTimestamp: Date.now(),
      });
    } else {
      this.patch({
        ...basePatch,
        screen: 'ended',
        transcript: [],
        ...createInitialListeningState(),
        activeActionIndex: 0,
        endedActionIndex: 0,
        dialogueIndex: -1,
        activeTranscriptCursor: -1,
      });
    }

    this.persistResumeState({
      lastContactIndex: selectedContactIndex,
      lastResumableGlassesScreen: options.screen,
      lastListeningMode: options.screen === 'listening' ? safeListeningMode : this.persistedResumeState.lastListeningMode,
    });
  }

  setLastInput(normalizedInput: NormalizedInput, rawEvent: RawEventDebugInfo) {
    this.patch({
      lastNormalizedInput: normalizedInput,
      lastRawEvent: rawEvent,
    });
  }

  setImageSyncDebug(update: Partial<AppState['imageSync']>) {
    this.patch({ imageSync: { ...this.state.imageSync, ...update } });
  }

  setReliabilityDebug(update: Partial<ReliabilityDebugInfo>) {
    this.patch({
      reliability: {
        ...this.state.reliability,
        ...update,
      },
    });
  }

  noteIgnoredStaleCallback(reason: string) {
    const now = Date.now();
    this.setReliabilityDebug({
      lastIgnoredStaleCallback: reason,
      lastIgnoredStaleCallbackAt: now,
    });
  }

  noteCleanup(reason: string) {
    const now = Date.now();
    this.setReliabilityDebug({
      lastCleanupReason: reason,
      lastCleanupAt: now,
    });
  }

  openScriptedSpeechWindow(entryId: number, role: TranscriptEntry['role']) {
    this.patchSpeechWindow({
      isOpen: true,
      source: 'scripted_text',
      entryId,
      role,
    });
  }

  openLiveAudioSpeechWindow(role: TranscriptEntry['role']) {
    this.patchSpeechWindow({
      isOpen: true,
      source: 'live_audio',
      entryId: null,
      role,
    });
  }

  closeSpeechWindow() {
    this.patchSpeechWindow(createInitialSpeechWindowState());
  }

  cancelSpeechWindow() {
    this.patchSpeechWindow(createInitialSpeechWindowState());
  }

  goToIncomingForSelectedContact() {
    this.patch({
      screen: 'incoming',
      engagedContactIndex: this.state.selectedContactIndex,
      ...createInitialListeningState(),
      activeActionIndex: 0,
      endedActionIndex: 0,
      dialogueIndex: -1,
      activeTranscriptCursor: -1,
      transcript: [],
      ...createInitialScriptedState(),
      speechWindow: createInitialSpeechWindowState(),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
    this.persistResumableScreen('incoming');
  }

  presentOutboundGreeting() {
    if (this.state.screen !== 'incoming') {
      return;
    }

    const contact = this.getCurrentContact();
    if (!contact) {
      return;
    }

    const greeting = generateGreeting(contact);
    const transcript = this.appendGeneratedResponseTurns([greeting]);
    const activeTranscriptCursor = getLatestTranscriptCursor(transcript);
    const entry = transcript[activeTranscriptCursor] ?? null;
    this.patch({
      screen: 'active',
      activeActionIndex: 0,
      transcript,
      activeTranscriptCursor,
      speechWindow: entry
        ? {
          isOpen: true,
          source: 'scripted_text',
          entryId: entry.id,
          role: entry.role,
        }
        : createInitialSpeechWindowState(),
      turnState: 'responding',
      pendingResponseId: null,
      responseError: null,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: Date.now(),
    });
    this.persistResumableScreen('active');
  }

  enterListeningTurn() {
    const listeningSessionId = this.state.listeningSessionId + 1;
    const captureSessionStartedAt = Date.now();
    this.patch({
      screen: 'listening',
      engagedContactIndex: this.getCurrentContactIndex(),
      ...createInitialListeningState(),
      activeActionIndex: 0,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      speechWindow: createInitialSpeechWindowState(),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(captureSessionStartedAt),
      ...createInitialSttState(listeningSessionId),
    });
    this.persistResumableScreen('listening');
  }

  transmitCurrentUserTurn() {
    if (this.state.screen !== 'listening') {
      return;
    }

    let newestUnhandledUser = this.findNewestUnhandledUserEntry();
    if (!newestUnhandledUser) {
      const draftText = this.getUsableListeningDraftText();
      if (draftText) {
        const committed = this.commitUserFinalTranscript(draftText, {
          speaker: 'YOU',
          contactName: this.getCurrentContact().name,
        });
        if (committed) {
          newestUnhandledUser = this.findNewestUnhandledUserEntry();
        }
      }
    }

    if (!newestUnhandledUser) {
      this.presentNoSpeechFallback();
      return;
    }

    const enteredAt = Date.now();
    this.patch({
      screen: 'active',
      engagedContactIndex: this.getCurrentContactIndex(),
      dialogueIndex: -1,
      activeActionIndex: 0,
      ...createInitialListeningState(),
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      speechWindow: createInitialSpeechWindowState(),
      turnState: 'awaiting_user',
      pendingResponseId: null,
      responseError: null,
      responseStatusTimestamp: enteredAt,
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
      ...createInitialScriptedState(),
    });

    const contact = this.getCurrentContact();
    if (!contact) {
      this.patch({
        turnState: 'error',
        responseError: 'No selected contact available for response generation.',
        responseStatusPhase: 'standby',
        responseStatusTimestamp: Date.now(),
      });
      return;
    }

    const responseWorkId = this.nextResponseWorkId++;
    const placeholderEntry: TranscriptEntry = {
      id: this.allocateTranscriptId(),
      role: 'contact',
      speaker: contact.name.toUpperCase(),
      text: '',
      contactName: contact.name,
      createdAt: Date.now(),
      responseJobId: responseWorkId,
      streamState: 'placeholder',
    };

    this.patch({
      transcript: [...this.state.transcript, placeholderEntry],
      pendingResponseId: responseWorkId,
      turnState: 'processing_user',
      responseError: null,
      responseStatusPhase: 'sending',
      responseStatusTimestamp: Date.now(),
    });
  }

  endListening() {
    this.patch({
      screen: 'ended',
      ...createInitialListeningState(),
      endedActionIndex: 0,
      transcript: this.dropActivePendingResponseArtifacts(),
      activeTranscriptCursor: getLatestTranscriptCursor(this.dropActivePendingResponseArtifacts()),
      speechWindow: createInitialSpeechWindowState(),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialScriptedState(),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
    this.persistResumableScreen('ended');
  }

  advanceDialogueOrEnd() {
    if (this.state.screen !== 'active') {
      return;
    }

    const transcriptLength = this.state.transcript.length;
    if (transcriptLength === 0) {
      this.patch({
        activeTranscriptCursor: -1,
        speechWindow: createInitialSpeechWindowState(),
      });
      return;
    }

    const current = this.state.activeTranscriptCursor;
    const currentScriptedIndex = this.state.scriptedLineEntryIds.findIndex((entryId) => {
      const entry = this.state.transcript[current];
      return entry?.id === entryId;
    });
    const scriptedNextEntryId = currentScriptedIndex >= 0
      ? this.state.scriptedLineEntryIds[currentScriptedIndex + 1] ?? null
      : null;
    const scriptedNextCursor = scriptedNextEntryId === null
      ? null
      : this.state.transcript.findIndex((entry) => entry.id === scriptedNextEntryId);
    const nextCursor = scriptedNextCursor !== null && scriptedNextCursor >= 0
      ? scriptedNextCursor
      : Math.min(current + 1, transcriptLength - 1);
    if (nextCursor === current) {
      if (!this.state.scriptedScenarioId) {
        const currentEntry = this.state.transcript[current] ?? null;
        const onlyGreetingTurn =
          transcriptLength === 1 &&
          currentEntry?.role === 'contact' &&
          this.state.lastHandledUserTranscriptId === null;
        if (onlyGreetingTurn) {
          this.enterListeningTurn();
          return;
        }

        this.endCall();
      }
      return;
    }

    this.presentTranscriptEntryByIndex(nextCursor);
  }

  endCall() {
    this.patch({
      screen: 'ended',
      ...createInitialListeningState(),
      endedActionIndex: 0,
      transcript: this.dropActivePendingResponseArtifacts(),
      activeTranscriptCursor: getLatestTranscriptCursor(this.dropActivePendingResponseArtifacts()),
      speechWindow: createInitialSpeechWindowState(),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialScriptedState(),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
    this.persistResumableScreen('ended');
  }

  ignoreIncoming() {
    this.patch({
      screen: 'ended',
      ...createInitialListeningState(),
      endedActionIndex: 0,
      transcript: this.dropActivePendingResponseArtifacts(),
      activeTranscriptCursor: getLatestTranscriptCursor(this.dropActivePendingResponseArtifacts()),
      speechWindow: createInitialSpeechWindowState(),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialScriptedState(),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
    this.persistResumableScreen('ended');
  }

  backToContacts() {
    this.patch({
      screen: 'contacts',
      // The Even contacts list does not carry a selected-row value across rebuilds,
      // so returning here visually resets the highlight to the first contact.
      selectedContactIndex: 0,
      engagedContactIndex: null,
      ...createInitialListeningState(),
      activeActionIndex: 0,
      endedActionIndex: 0,
      dialogueIndex: -1,
      activeTranscriptCursor: -1,
      transcript: [],
      ...createInitialScriptedState(),
      speechWindow: createInitialSpeechWindowState(),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
    this.persistResumeState({ lastContactIndex: 0 });
    this.persistResumableScreen('contacts');
  }

  redialCurrentContact() {
    this.goToIncomingForSelectedContact();
  }

  retryListeningTurn() {
    const newestUnhandledIndex = this.findNewestUnhandledUserEntryIndex();
    const transcript = newestUnhandledIndex >= 0
      ? this.state.transcript.filter((_, index) => index !== newestUnhandledIndex)
      : this.state.transcript;
    const listeningSessionId = this.state.listeningSessionId + 1;
    const captureSessionStartedAt = Date.now();

    this.patch({
      screen: 'listening',
      engagedContactIndex: this.getCurrentContactIndex(),
      transcript,
      activeTranscriptCursor: getLatestTranscriptCursor(transcript),
      speechWindow: createInitialSpeechWindowState(),
      ...createInitialListeningState(),
      pendingResponseId: null,
      turnState: 'idle',
      responseError: null,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: Date.now(),
      ...createInitialAudioCaptureState(captureSessionStartedAt),
      ...createInitialSttState(listeningSessionId),
    });
    this.persistResumableScreen('listening');
  }

  pauseListeningCapture() {
    if (this.state.screen !== 'listening' || this.state.listeningMode !== 'capture') {
      return;
    }

    if (this.state.sttPartialTranscript.trim()) {
      this.clearSttPartialTranscript();
    }

    this.patch({
      listeningCaptureState: 'paused',
      listeningActionIndex: 0,
      listeningReviewOffset: 0,
    });
  }

  resumeListeningCapture() {
    if (this.state.screen !== 'listening' || this.state.listeningMode !== 'capture') {
      return;
    }

    this.patch({
      listeningCaptureState: 'capturing',
      listeningActionIndex: 0,
    });
  }

  completeListeningCaptureFromTimeout() {
    if (this.state.screen !== 'listening' || this.state.listeningMode !== 'capture') {
      return;
    }

    if (this.state.sttPartialTranscript.trim()) {
      this.clearSttPartialTranscript();
    }

    if (this.findNewestUnhandledUserEntry() || this.getUsableListeningDraftText()) {
      this.patch({
        listeningMode: 'actions',
        listeningCaptureState: 'paused',
        listeningActionIndex: 0,
        listeningReviewOffset: 0,
        responseError: null,
      });
      this.persistResumeState({ lastListeningMode: 'actions' });
      return;
    }

    this.presentNoSpeechFallback();
  }

  presentNoSpeechFallback() {
    const contact = this.getCurrentContact();
    const transcript = this.appendGeneratedResponseTurns([generateNoSpeechFallback(contact)]);
    const activeTranscriptCursor = getLatestTranscriptCursor(transcript);
    const entry = transcript[activeTranscriptCursor] ?? null;

    this.patch({
      screen: 'active',
      engagedContactIndex: this.getCurrentContactIndex(),
      transcript,
      activeTranscriptCursor,
      speechWindow: this.buildSpeechWindowForEntry(entry),
      activeActionIndex: 0,
      ...createInitialListeningState(),
      ...createInitialScriptedState(),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
      turnState: 'complete',
      pendingResponseId: null,
      responseError: null,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: Date.now(),
    });
    this.persistResumableScreen('active');
  }

  setAudioCaptureStatus(status: AudioCaptureStatus, options?: { micOpen?: boolean; error?: string | null }) {
    const patch: Partial<AppState> = {
      audioCaptureStatus: status,
    };

    if (typeof options?.micOpen === 'boolean') {
      patch.micOpen = options.micOpen;
    }

    if (options && 'error' in options) {
      patch.audioError = options.error ?? null;
    } else if (status !== 'error') {
      patch.audioError = null;
    }

    const nextMicOpen = typeof patch.micOpen === 'boolean' ? patch.micOpen : this.state.micOpen;
    const nextError = Object.prototype.hasOwnProperty.call(patch, 'audioError') ? patch.audioError ?? null : this.state.audioError;
    if (
      this.state.audioCaptureStatus === status &&
      this.state.micOpen === nextMicOpen &&
      this.state.audioError === nextError
    ) {
      return;
    }

    this.patch(patch);

    const shouldForceCloseLiveAudio = !nextMicOpen || status === 'idle' || status === 'closing' || status === 'error';
    this.reconcileLiveAudioSpeechWindow({
      partialText: this.state.sttPartialTranscript,
      listeningActivityLevel: this.state.listeningActivityLevel,
      forceClose: shouldForceCloseLiveAudio,
    });
  }

  updateAudioCaptureMetrics(update: {
    audioFrameCount: number;
    audioBufferByteLength: number;
    bufferedAudioDurationMs: number;
    elapsedCaptureDurationMs: number;
    lastAudioFrameAt: number;
    listeningActivityLevel: number;
  }) {
    if (
      this.state.audioFrameCount === update.audioFrameCount &&
      this.state.audioBufferByteLength === update.audioBufferByteLength &&
      this.state.bufferedAudioDurationMs === update.bufferedAudioDurationMs &&
      this.state.elapsedCaptureDurationMs === update.elapsedCaptureDurationMs &&
      this.state.lastAudioFrameAt === update.lastAudioFrameAt &&
      this.state.listeningActivityLevel === update.listeningActivityLevel
    ) {
      return;
    }

    this.patch({
      audioFrameCount: update.audioFrameCount,
      audioBufferByteLength: update.audioBufferByteLength,
      bufferedAudioDurationMs: update.bufferedAudioDurationMs,
      elapsedCaptureDurationMs: update.elapsedCaptureDurationMs,
      lastAudioFrameAt: update.lastAudioFrameAt,
      listeningActivityLevel: update.listeningActivityLevel,
    });

    this.reconcileLiveAudioSpeechWindow({
      partialText: this.state.sttPartialTranscript,
      listeningActivityLevel: update.listeningActivityLevel,
    });
  }

  setElapsedCaptureDuration(elapsedCaptureDurationMs: number) {
    const normalized = Math.max(0, Math.round(elapsedCaptureDurationMs));
    if (this.state.elapsedCaptureDurationMs === normalized) {
      return;
    }

    this.patch({ elapsedCaptureDurationMs: normalized });
  }

  setSttStatus(status: SttStatus, options?: { error?: string | null }) {
    const patch: Partial<AppState> = {
      sttStatus: status,
    };

    if (options && 'error' in options) {
      patch.sttError = options.error ?? null;
    } else if (status !== 'error') {
      patch.sttError = null;
    }

    const nextError = Object.prototype.hasOwnProperty.call(patch, 'sttError') ? patch.sttError ?? null : this.state.sttError;
    if (this.state.sttStatus === status && this.state.sttError === nextError) {
      return;
    }

    this.patch(patch);
    if ((status === 'idle' || status === 'closing' || status === 'error') && this.state.speechWindow.source === 'live_audio') {
      this.reconcileLiveAudioSpeechWindow({ forceClose: true });
    }
  }

  setSttPartialTranscript(text: string) {
    if (this.state.sttPartialTranscript === text) {
      return;
    }

    const now = Date.now();
    this.patch({
      sttPartialTranscript: text,
      sttDraftDisplayText: text.trim() ? text : this.state.sttDraftDisplayText,
      sttDraftVisibleUntil: text.trim() ? null : this.state.sttDraftVisibleUntil,
      lastTranscriptAt: now,
    });

    this.reconcileLiveAudioSpeechWindow({
      partialText: text,
      listeningActivityLevel: this.state.listeningActivityLevel,
    });
  }

  clearSttPartialTranscript() {
    if (!this.state.sttPartialTranscript && !this.state.sttDraftDisplayText) {
      return;
    }

    const preservedDraft = this.state.sttPartialTranscript.trim() || this.state.sttDraftDisplayText.trim();
    this.patch({
      sttPartialTranscript: '',
      sttDraftDisplayText: preservedDraft,
      sttDraftVisibleUntil: preservedDraft ? Date.now() + 1600 : null,
      speechWindow: createInitialSpeechWindowState(),
    });
  }

  stageSttDraftTranscript(text: string, options?: { visibleForMs?: number }) {
    const normalized = text.trim();
    const now = Date.now();
    this.patch({
      sttPartialTranscript: '',
      sttDraftDisplayText: normalized,
      sttDraftVisibleUntil: normalized
        ? now + Math.max(250, options?.visibleForMs ?? 1600)
        : null,
      speechWindow: createInitialSpeechWindowState(),
      lastTranscriptAt: now,
    });
  }

  commitUserFinalTranscript(text: string, options?: { speaker?: string; contactName?: string }) {
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }

    const contactName = options?.contactName ?? this.getCurrentContact().name;
    const entry: TranscriptEntry = {
      id: this.allocateTranscriptId(),
      role: 'user',
      speaker: options?.speaker ?? 'YOU',
      text: normalized,
      contactName,
      createdAt: Date.now(),
    };

    const transcript = [...this.state.transcript, entry];
    this.patch({
      transcript,
      activeTranscriptCursor: getLatestTranscriptCursor(transcript),
      listeningMode: this.state.screen === 'listening' ? 'actions' : this.state.listeningMode,
      listeningCaptureState: this.state.screen === 'listening' ? 'paused' : this.state.listeningCaptureState,
      listeningActionIndex: 0,
      listeningReviewOffset: 0,
      ...createInitialScriptedState(),
      sttPartialTranscript: '',
      sttDraftDisplayText: '',
      sttDraftVisibleUntil: null,
      speechWindow: createInitialSpeechWindowState(),
      pendingResponseId: null,
      turnState: this.state.screen === 'active' ? 'awaiting_user' : this.state.turnState,
      responseError: null,
      responseStatusPhase: this.state.screen === 'active' ? 'standby' : this.state.responseStatusPhase,
      responseStatusTimestamp: Date.now(),
      lastTranscriptAt: Date.now(),
    });
    return true;
  }

  commitTranscriptEntry(entry: Omit<TranscriptEntry, 'id'> | TranscriptEntry) {
    if ('id' in entry && entry.id >= this.nextTranscriptId) {
      this.nextTranscriptId = entry.id + 1;
    }

    const nextEntry: TranscriptEntry = {
      ...entry,
      id: 'id' in entry && entry.id > 0 ? entry.id : this.allocateTranscriptId(),
    };

    const transcript = [...this.state.transcript, nextEntry];
    const nextSpeechWindow = nextEntry.role === 'contact' || nextEntry.role === 'system'
      ? {
        isOpen: true,
        source: 'scripted_text' as const,
        entryId: nextEntry.id,
        role: nextEntry.role,
      }
      : createInitialSpeechWindowState();
    this.patch({
      transcript,
      activeTranscriptCursor: getLatestTranscriptCursor(transcript),
      speechWindow: nextSpeechWindow,
      pendingResponseId: null,
      turnState: nextEntry.role === 'user' ? 'awaiting_user' : this.state.turnState,
      responseError: null,
      responseStatusPhase: nextEntry.role === 'user' ? 'standby' : this.state.responseStatusPhase,
      responseStatusTimestamp: Date.now(),
      lastTranscriptAt: Date.now(),
    });
  }

  setResponseStatusPhase(responseStatusPhase: ResponseStatusPhase, options?: { responseJobId?: number | null; turnState?: TurnState }) {
    if (
      options?.responseJobId !== undefined &&
      options.responseJobId !== null &&
      !this.isPendingResponseJobActive(options.responseJobId)
    ) {
      this.noteIgnoredStaleCallback(`response-status:${options.responseJobId}`);
      return false;
    }

    this.patch({
      responseStatusPhase,
      turnState: options?.turnState ?? this.state.turnState,
      responseStatusTimestamp: Date.now(),
    });
    return true;
  }

  applyStreamingResponsePartial(responseJobId: number, partial: Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>) {
    if (!this.isPendingResponseJobActive(responseJobId)) {
      this.noteIgnoredStaleCallback(`response-partial:${responseJobId}`);
      return false;
    }

    const entryIndex = this.findResponseEntryIndex(responseJobId, partial.role);
    if (entryIndex < 0) {
      this.noteIgnoredStaleCallback(`response-partial-missing:${responseJobId}`);
      return false;
    }

    const currentEntry = this.state.transcript[entryIndex];
    const nextEntry: TranscriptEntry = {
      ...currentEntry,
      speaker: partial.speaker,
      text: partial.text,
      emotion: partial.emotion,
      streamState: 'streaming',
    };
    const transcript = this.replaceTranscriptEntryAt(entryIndex, nextEntry);

    this.patch({
      transcript,
      activeTranscriptCursor: entryIndex,
      speechWindow: this.buildSpeechWindowForEntry(nextEntry),
      turnState: 'responding',
      responseError: null,
      responseStatusPhase: 'receiving',
      responseStatusTimestamp: Date.now(),
      lastTranscriptAt: Date.now(),
    });
    return true;
  }

  finalizePendingResponse(options: {
    responseJobId: number;
    handledUserTranscriptId: number;
    responseTurns: Array<Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>>;
  }) {
    const { responseJobId, handledUserTranscriptId, responseTurns } = options;
    if (!this.isPendingResponseJobActive(responseJobId)) {
      this.noteIgnoredStaleCallback(`response-final:${responseJobId}`);
      return false;
    }

    const placeholderIndex = this.findResponseEntryIndex(responseJobId, 'contact');
    const baseTranscript = placeholderIndex >= 0
      ? this.state.transcript.filter((_, index) => index !== placeholderIndex)
      : this.state.transcript;
    const contactName = this.getCurrentContact().name;
    const timestamp = Date.now();
    const entries: TranscriptEntry[] = responseTurns.map((turn) => ({
      id: this.allocateTranscriptId(),
      role: turn.role,
      speaker: turn.speaker,
      text: turn.text,
      contactName,
      createdAt: timestamp,
      emotion: turn.emotion,
      responseJobId: turn.role === 'contact' ? responseJobId : null,
      streamState: turn.role === 'contact' ? 'complete' : undefined,
    }));
    const transcript = [...baseTranscript, ...entries];
    const firstPresentedIndex = entries.length > 0
      ? transcript.length - entries.length
      : getLatestTranscriptCursor(transcript);
    const firstPresentedEntry = transcript[firstPresentedIndex] ?? null;

    this.patch({
      transcript,
      activeTranscriptCursor: firstPresentedIndex,
      lastHandledUserTranscriptId: handledUserTranscriptId,
      pendingResponseId: null,
      turnState: 'complete',
      responseError: null,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: timestamp,
      speechWindow: this.buildSpeechWindowForEntry(firstPresentedEntry),
      lastTranscriptAt: timestamp,
    });
    return true;
  }

  failPendingResponse(responseJobId: number, message: string) {
    if (!this.isPendingResponseJobActive(responseJobId)) {
      this.noteIgnoredStaleCallback(`response-error:${responseJobId}`);
      return false;
    }

    const transcript = this.removeResponsePlaceholderEntries(responseJobId);
    this.patch({
      transcript,
      activeTranscriptCursor: getLatestTranscriptCursor(transcript),
      pendingResponseId: null,
      turnState: 'error',
      responseError: message,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: Date.now(),
      speechWindow: createInitialSpeechWindowState(),
    });
    return true;
  }

  startScriptedScenario(options: { contactIndex: number; scenarioId: string; autoplay?: boolean }) {
    const scenario = getScriptedScenarioById(options.scenarioId);
    const contact = CONTACTS[options.contactIndex];
    if (!scenario || !contact) {
      return false;
    }

    const turns = createScriptedTranscriptTurns({
      scenario,
      contactName: contact.name,
    });
    if (turns.length === 0) {
      return false;
    }

    const timestamp = Date.now();
    const transcript: TranscriptEntry[] = [];
    const entryIds: number[] = [];
    const metadataByEntryId: Record<number, ScriptedLineMetadata> = {};
    for (const turn of turns) {
      const id = this.allocateTranscriptId();
      transcript.push({
        id,
        role: turn.role,
        speaker: turn.speaker,
        text: turn.text,
        contactName: contact.name,
        createdAt: timestamp,
        emotion: turn.emotion,
      });
      entryIds.push(id);
      if (turn.metadata) {
        metadataByEntryId[id] = turn.metadata;
      }
    }

    const firstEntry = transcript[0];
    const activeTranscriptCursor = 0;
    this.patch({
      selectedContactIndex: options.contactIndex,
      engagedContactIndex: options.contactIndex,
      screen: 'active',
      activeActionIndex: 0,
      ...createInitialListeningState(),
      endedActionIndex: 0,
      dialogueIndex: -1,
      transcript,
      activeTranscriptCursor,
      turnState: 'responding',
      responseError: null,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: timestamp,
      pendingResponseId: null,
      lastHandledUserTranscriptId: null,
      speechWindow: firstEntry.role === 'contact' || firstEntry.role === 'system'
        ? {
          isOpen: true,
          source: 'scripted_text',
          entryId: firstEntry.id,
          role: firstEntry.role,
        }
        : createInitialSpeechWindowState(),
      scriptedScenarioId: scenario.id,
      scriptedScenarioTitle: scenario.title,
      scriptedLineEntryIds: entryIds,
      scriptedLineMetadataByEntryId: metadataByEntryId,
      scriptedAutoplay: Boolean(options.autoplay),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
    this.persistResumeState({
      lastContactIndex: this.clampContactIndex(options.contactIndex),
      lastResumableGlassesScreen: 'active',
    });

    return true;
  }

  setScriptedAutoplay(enabled: boolean) {
    this.patch({ scriptedAutoplay: enabled });
  }

  replayCurrentScriptedLine() {
    const currentEntry = this.state.transcript[this.state.activeTranscriptCursor];
    if (!currentEntry || !this.state.scriptedScenarioId) {
      return;
    }

    if (currentEntry.role === 'contact' || currentEntry.role === 'system') {
      this.openScriptedSpeechWindow(currentEntry.id, currentEntry.role);
    }
  }

  stopScriptedScenario() {
    this.patch({
      ...createInitialScriptedState(),
      screen: 'ended',
      endedActionIndex: 0,
      speechWindow: createInitialSpeechWindowState(),
      turnState: 'idle',
      pendingResponseId: null,
      responseError: null,
      responseStatusPhase: 'standby',
      responseStatusTimestamp: Date.now(),
    });
    this.persistResumableScreen('ended');
  }
}

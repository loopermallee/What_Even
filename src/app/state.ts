import { CONTACTS } from './contacts';
import { generateDeterministicResponse } from './responseEngine';
import type {
  AudioCaptureStatus,
  AppScreen,
  AppState,
  DevicePageLifecycleState,
  NormalizedInput,
  RawEventDebugInfo,
  ReliabilityDebugInfo,
  SttStatus,
  TranscriptEntry,
  TurnState,
} from './types';

const DEVICE_PAGE_LIFECYCLE_KEY = 'what-even:device-page-lifecycle';

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

function createInitialAudioCaptureState() {
  return {
    audioCaptureStatus: 'idle' as AudioCaptureStatus,
    micOpen: false,
    audioFrameCount: 0,
    audioBufferByteLength: 0,
    bufferedAudioDurationMs: 0,
    lastAudioFrameAt: null as number | null,
    listeningActivityLevel: 0,
    audioError: null as string | null,
  };
}

function createInitialSttState(listeningSessionId: number) {
  return {
    sttStatus: 'idle' as SttStatus,
    sttPartialTranscript: '',
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
    responseStatusTimestamp: null as number | null,
  };
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

export function createInitialState(): AppState {
  return {
    screen: 'contacts',
    screenBeforeDebug: 'contacts',
    started: false,
    selectedContactIndex: 0,
    incomingActionIndex: 0,
    listeningActionIndex: 0,
    activeActionIndex: 0,
    endedActionIndex: 0,
    dialogueIndex: -1,
    activeTranscriptCursor: -1,
    transcript: [],
    ...createInitialTurnState(),
    deviceLifecycleState: readDevicePageLifecycleState(),
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
    logs: [],
  };
}

export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private nextTranscriptId: number;
  private nextResponseWorkId = 1;

  constructor(initialState: AppState = createInitialState()) {
    this.state = initialState;
    this.nextTranscriptId = this.computeNextTranscriptId(initialState.transcript);
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

  private clearTurnWorkForBoundary(nextTurnState: TurnState = 'idle') {
    return {
      ...createInitialTurnState(),
      turnState: nextTurnState,
      responseStatusTimestamp: Date.now(),
    };
  }

  private findNewestUnhandledUserEntry() {
    const lastHandled = this.state.lastHandledUserTranscriptId;
    for (let index = this.state.transcript.length - 1; index >= 0; index -= 1) {
      const entry = this.state.transcript[index];
      if (entry.role !== 'user') {
        continue;
      }

      if (lastHandled !== null && entry.id <= lastHandled) {
        continue;
      }

      return entry;
    }

    return null;
  }

  private appendGeneratedResponseTurns(responseTurns: Array<Pick<TranscriptEntry, 'role' | 'speaker' | 'text'>>) {
    if (responseTurns.length === 0) {
      return this.state.transcript;
    }

    const contactName = CONTACTS[this.state.selectedContactIndex]?.name ?? 'Unknown';
    const timestamp = Date.now();
    const entries: TranscriptEntry[] = responseTurns.map((turn) => ({
      id: this.allocateTranscriptId(),
      role: turn.role,
      speaker: turn.speaker,
      text: turn.text,
      contactName,
      createdAt: timestamp,
    }));

    return [...this.state.transcript, ...entries];
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
    this.patch({ started });
  }

  setScreen(screen: AppScreen) {
    this.patch({ screen });
  }

  enterDebugScreen() {
    if (!import.meta.env.DEV || this.state.screen === 'debug') {
      return;
    }

    this.patch({
      screenBeforeDebug: this.state.screen,
      screen: 'debug',
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

  setSelectedContactIndex(index: number) {
    const size = CONTACTS.length;
    const normalized = ((index % size) + size) % size;
    if (normalized === this.state.selectedContactIndex) {
      return;
    }

    this.patch({
      selectedContactIndex: normalized,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      ...this.clearTurnWorkForBoundary('idle'),
    });
  }

  moveContactSelection(direction: -1 | 1) {
    this.setSelectedContactIndex(this.state.selectedContactIndex + direction);
  }

  setIncomingActionIndex(index: number) {
    this.patch({ incomingActionIndex: clampActionIndex(index, 2) });
  }

  setActiveActionIndex(index: number) {
    this.patch({ activeActionIndex: clampActionIndex(index, 2) });
  }

  setListeningActionIndex(index: number) {
    this.patch({ listeningActionIndex: clampActionIndex(index, 2) });
  }

  setEndedActionIndex(index: number) {
    this.patch({ endedActionIndex: clampActionIndex(index, 2) });
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

  goToIncomingForSelectedContact() {
    this.patch({
      screen: 'incoming',
      incomingActionIndex: 0,
      listeningActionIndex: 0,
      activeActionIndex: 0,
      endedActionIndex: 0,
      dialogueIndex: -1,
      activeTranscriptCursor: -1,
      transcript: [],
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
  }

  answerIncomingAndStartListening() {
    const listeningSessionId = this.state.listeningSessionId + 1;
    this.patch({
      screen: 'listening',
      listeningActionIndex: 0,
      activeActionIndex: 0,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(listeningSessionId),
    });
  }

  continueListeningAndStartActiveCall() {
    const enteredAt = Date.now();
    this.patch({
      screen: 'active',
      dialogueIndex: -1,
      activeActionIndex: 0,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      turnState: 'awaiting_user',
      pendingResponseId: null,
      responseError: null,
      responseStatusTimestamp: enteredAt,
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });

    const newestUnhandledUser = this.findNewestUnhandledUserEntry();
    if (!newestUnhandledUser) {
      return;
    }

    const contact = CONTACTS[this.state.selectedContactIndex];
    if (!contact) {
      this.patch({
        turnState: 'error',
        responseError: 'No selected contact available for deterministic response generation.',
        responseStatusTimestamp: Date.now(),
      });
      return;
    }

    const responseWorkId = this.nextResponseWorkId++;
    this.patch({
      pendingResponseId: responseWorkId,
      turnState: 'processing_user',
      responseError: null,
      responseStatusTimestamp: Date.now(),
    });

    try {
      const generated = generateDeterministicResponse(contact, newestUnhandledUser.text);

      if (this.state.screen !== 'active' || this.state.pendingResponseId !== responseWorkId) {
        return;
      }

      this.patch({
        turnState: 'responding',
        responseStatusTimestamp: Date.now(),
      });

      const transcript = this.appendGeneratedResponseTurns(generated);
      this.patch({
        transcript,
        activeTranscriptCursor: getLatestTranscriptCursor(transcript),
        lastHandledUserTranscriptId: newestUnhandledUser.id,
        pendingResponseId: null,
        turnState: 'complete',
        responseError: null,
        responseStatusTimestamp: Date.now(),
      });
    } catch (error) {
      if (this.state.pendingResponseId !== responseWorkId) {
        return;
      }

      this.patch({
        pendingResponseId: null,
        turnState: 'error',
        responseError: `Deterministic response failed: ${String(error)}`,
        responseStatusTimestamp: Date.now(),
      });
    }
  }

  endListening() {
    this.patch({
      screen: 'ended',
      endedActionIndex: 0,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
  }

  advanceDialogueOrEnd() {
    if (this.state.screen !== 'active') {
      return;
    }

    const transcriptLength = this.state.transcript.length;
    if (transcriptLength === 0) {
      this.patch({ activeTranscriptCursor: -1 });
      return;
    }

    const current = this.state.activeTranscriptCursor;
    const nextCursor = Math.min(current + 1, transcriptLength - 1);
    if (nextCursor === current) {
      return;
    }

    this.patch({ activeTranscriptCursor: nextCursor });
  }

  endCall() {
    this.patch({
      screen: 'ended',
      endedActionIndex: 0,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
  }

  ignoreIncoming() {
    this.patch({
      screen: 'ended',
      endedActionIndex: 0,
      activeTranscriptCursor: getLatestTranscriptCursor(this.state.transcript),
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
  }

  backToContacts() {
    this.patch({
      screen: 'contacts',
      incomingActionIndex: 0,
      listeningActionIndex: 0,
      activeActionIndex: 0,
      endedActionIndex: 0,
      dialogueIndex: -1,
      activeTranscriptCursor: -1,
      transcript: [],
      ...this.clearTurnWorkForBoundary('idle'),
      ...createInitialAudioCaptureState(),
      ...createInitialSttState(this.state.listeningSessionId),
    });
  }

  redialCurrentContact() {
    this.goToIncomingForSelectedContact();
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
  }

  updateAudioCaptureMetrics(update: {
    audioFrameCount: number;
    audioBufferByteLength: number;
    bufferedAudioDurationMs: number;
    lastAudioFrameAt: number;
    listeningActivityLevel: number;
  }) {
    if (
      this.state.audioFrameCount === update.audioFrameCount &&
      this.state.audioBufferByteLength === update.audioBufferByteLength &&
      this.state.bufferedAudioDurationMs === update.bufferedAudioDurationMs &&
      this.state.lastAudioFrameAt === update.lastAudioFrameAt &&
      this.state.listeningActivityLevel === update.listeningActivityLevel
    ) {
      return;
    }

    this.patch({
      audioFrameCount: update.audioFrameCount,
      audioBufferByteLength: update.audioBufferByteLength,
      bufferedAudioDurationMs: update.bufferedAudioDurationMs,
      lastAudioFrameAt: update.lastAudioFrameAt,
      listeningActivityLevel: update.listeningActivityLevel,
    });
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
  }

  setSttPartialTranscript(text: string) {
    if (this.state.sttPartialTranscript === text) {
      return;
    }

    this.patch({
      sttPartialTranscript: text,
      lastTranscriptAt: Date.now(),
    });
  }

  clearSttPartialTranscript() {
    if (!this.state.sttPartialTranscript) {
      return;
    }

    this.patch({ sttPartialTranscript: '' });
  }

  commitUserFinalTranscript(text: string, options?: { speaker?: string; contactName?: string }) {
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }

    const contactName = options?.contactName ?? CONTACTS[this.state.selectedContactIndex]?.name ?? 'Unknown';
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
      sttPartialTranscript: '',
      pendingResponseId: null,
      turnState: this.state.screen === 'active' ? 'awaiting_user' : this.state.turnState,
      responseError: null,
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
    this.patch({
      transcript,
      activeTranscriptCursor: getLatestTranscriptCursor(transcript),
      pendingResponseId: null,
      turnState: nextEntry.role === 'user' ? 'awaiting_user' : this.state.turnState,
      responseError: null,
      responseStatusTimestamp: Date.now(),
      lastTranscriptAt: Date.now(),
    });
  }
}

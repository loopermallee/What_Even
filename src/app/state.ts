import { CONTACTS, RIGHT_CHARACTER } from './contacts';
import type {
  AudioCaptureStatus,
  AppScreen,
  AppState,
  DevicePageLifecycleState,
  NormalizedInput,
  RawEventDebugInfo,
  TranscriptEntry,
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
    transcript: [],
    deviceLifecycleState: readDevicePageLifecycleState(),
    lastNormalizedInput: null,
    lastRawEvent: null,
    imageSync: {
      lastPortraitAsset: null,
      lastResult: 'idle',
      lastAt: null,
    },
    ...createInitialAudioCaptureState(),
    logs: [],
  };
}

export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(initialState: AppState = createInitialState()) {
    this.state = initialState;
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
    this.patch({ selectedContactIndex: normalized });
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

  goToIncomingForSelectedContact() {
    this.patch({
      screen: 'incoming',
      incomingActionIndex: 0,
      listeningActionIndex: 0,
      activeActionIndex: 0,
      endedActionIndex: 0,
      dialogueIndex: -1,
      transcript: [],
      ...createInitialAudioCaptureState(),
    });
  }

  answerIncomingAndStartListening() {
    this.patch({
      screen: 'listening',
      listeningActionIndex: 0,
      activeActionIndex: 0,
      ...createInitialAudioCaptureState(),
    });
  }

  continueListeningAndStartActiveCall() {
    const contact = CONTACTS[this.state.selectedContactIndex];
    const line = contact.dialogue[0];
    const transcript: TranscriptEntry[] = line
      ? [{
        speaker: line.speaker === 'left' ? contact.name.toUpperCase() : RIGHT_CHARACTER.name.toUpperCase(),
        text: line.text,
        contactName: contact.name,
        createdAt: Date.now(),
      }]
      : [];

    this.patch({
      screen: 'active',
      dialogueIndex: line ? 0 : -1,
      activeActionIndex: 0,
      transcript,
      ...createInitialAudioCaptureState(),
    });
  }

  endListening() {
    this.patch({
      screen: 'ended',
      endedActionIndex: 0,
      ...createInitialAudioCaptureState(),
    });
  }

  advanceDialogueOrEnd() {
    const contact = CONTACTS[this.state.selectedContactIndex];
    if (this.state.dialogueIndex < 0) {
      this.continueListeningAndStartActiveCall();
      return;
    }

    const isFinal = this.state.dialogueIndex >= contact.dialogue.length - 1;
    if (isFinal) {
      this.patch({ screen: 'ended', endedActionIndex: 0 });
      return;
    }

    const nextIndex = this.state.dialogueIndex + 1;
    const line = contact.dialogue[nextIndex];
    const entry: TranscriptEntry | null = line
      ? {
        speaker: line.speaker === 'left' ? contact.name.toUpperCase() : RIGHT_CHARACTER.name.toUpperCase(),
        text: line.text,
        contactName: contact.name,
        createdAt: Date.now(),
      }
      : null;

    this.patch({
      dialogueIndex: nextIndex,
      transcript: entry ? [...this.state.transcript, entry] : this.state.transcript,
    });
  }

  endCall() {
    this.patch({
      screen: 'ended',
      endedActionIndex: 0,
      ...createInitialAudioCaptureState(),
    });
  }

  ignoreIncoming() {
    this.patch({
      screen: 'ended',
      endedActionIndex: 0,
      ...createInitialAudioCaptureState(),
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
      transcript: [],
      ...createInitialAudioCaptureState(),
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

    this.patch(patch);
  }

  updateAudioCaptureMetrics(update: {
    audioFrameCount: number;
    audioBufferByteLength: number;
    bufferedAudioDurationMs: number;
    lastAudioFrameAt: number;
    listeningActivityLevel: number;
  }) {
    this.patch({
      audioFrameCount: update.audioFrameCount,
      audioBufferByteLength: update.audioBufferByteLength,
      bufferedAudioDurationMs: update.bufferedAudioDurationMs,
      lastAudioFrameAt: update.lastAudioFrameAt,
      listeningActivityLevel: update.listeningActivityLevel,
    });
  }
}

export type SpeakerSide = 'left' | 'right';
export type CodecCharacterId = 'snake' | 'otacon' | 'meryl' | 'colonel';
export type CodecExpression = 'idle' | 'stern' | 'angry' | 'surprised' | 'thinking' | 'hurt';
export type CodecBlinkState = 'open' | 'closing' | 'closed' | 'opening';
export type CodecMouthFrame = 'closed' | 'half' | 'open';
export type CodecTalkingMode = 'silent' | 'scripted_text' | 'live_audio';
export type SpeechWindowSource = 'none' | 'scripted_text' | 'live_audio';

export type DialogueLine = {
  speaker: SpeakerSide;
  text: string;
  emotion?: CodecExpression;
};

export type Contact = {
  name: string;
  code: string;
  frequency: string;
  portraitTag: string;
  characterId?: CodecCharacterId;
  dialogue: DialogueLine[];
};

export type AppScreen = 'contacts' | 'incoming' | 'listening' | 'active' | 'ended' | 'debug';

export type DevicePageLifecycleState = 'unknown' | 'active' | 'inactive';
export type EvenStartupStatus = 'idle' | 'starting' | 'ready' | 'blocked';
export type EvenStartupBlockedCode =
  | 'native_host_missing'
  | 'startup_lifecycle_failed'
  | 'device_session_missing'
  | 'rebuild_failed_initial'
  | 'stale_recovery_failed'
  | 'listener_attach_failed'
  | 'startup_exception';

export type EventBranchSource = 'listEvent' | 'textEvent' | 'sysEvent' | 'unknown';

export type NormalizedInput = 'UP' | 'DOWN' | 'TAP' | 'DOUBLE_TAP' | 'AT_TOP' | 'AT_BOTTOM';

export type RawEventDebugInfo = {
  source: EventBranchSource;
  rawEventTypeName: string;
  normalizedTypeToken: string;
  eventTypeCandidates: string[];
  containerID: number | null;
  containerName: string | null;
  currentSelectItemName: string | null;
  currentSelectItemIndex: number | null;
  rawListEventFieldKeys: string[];
  rawListEventFieldSummary: string | null;
};

export type TranscriptEntry = {
  id: number;
  role: 'user' | 'contact' | 'system';
  speaker: string;
  text: string;
  contactName: string;
  createdAt: number;
  emotion?: CodecExpression;
};

export type SpeechWindowState = {
  isOpen: boolean;
  source: SpeechWindowSource;
  entryId: number | null;
  role: TranscriptEntry['role'] | null;
};

export type TurnState = 'idle' | 'awaiting_user' | 'processing_user' | 'responding' | 'complete' | 'error';

export type AudioCaptureStatus = 'idle' | 'opening' | 'listening' | 'closing' | 'error';
export type SttStatus = 'idle' | 'connecting' | 'streaming' | 'closing' | 'error';
export type ErrorCategory =
  | 'config_error'
  | 'auth_error'
  | 'network_error'
  | 'stt_error'
  | 'mic_error'
  | 'session_error'
  | 'state_error'
  | 'unknown_error';

export type ImageSyncDebugInfo = {
  lastPortraitAsset: string | null;
  lastResult: 'idle' | 'success' | 'failed';
  lastAt: number | null;
};

export type ReliabilityDebugInfo = {
  activeSttSessionToken: number | null;
  activeSttListeningSessionId: number | null;
  sttReconnectAttemptedSessionId: number | null;
  sttRetryScheduledForSessionId: number | null;
  sttRetryScheduledAt: number | null;
  sttRetryCancelledAt: number | null;
  lastIgnoredStaleCallback: string | null;
  lastIgnoredStaleCallbackAt: number | null;
  lastCleanupReason: string | null;
  lastCleanupAt: number | null;
  pendingPartialFlush: boolean;
  lastErrorCategory: ErrorCategory | null;
  lastErrorCode: string | null;
};

export type AppState = {
  screen: AppScreen;
  screenBeforeDebug: Exclude<AppScreen, 'debug'>;
  started: boolean;
  simulatorSessionDetected: boolean;
  evenNativeHostDetected: boolean;
  selectedContactIndex: number;
  incomingActionIndex: number;
  listeningActionIndex: number;
  activeActionIndex: number;
  endedActionIndex: number;
  dialogueIndex: number;
  activeTranscriptCursor: number;
  transcript: TranscriptEntry[];
  turnState: TurnState;
  lastHandledUserTranscriptId: number | null;
  pendingResponseId: number | null;
  responseError: string | null;
  responseStatusTimestamp: number | null;
  deviceLifecycleState: DevicePageLifecycleState;
  evenStartupStatus: EvenStartupStatus;
  evenStartupBlockedCode: EvenStartupBlockedCode | null;
  evenStartupBlockedMessage: string | null;
  lastNormalizedInput: NormalizedInput | null;
  lastRawEvent: RawEventDebugInfo | null;
  imageSync: ImageSyncDebugInfo;
  audioCaptureStatus: AudioCaptureStatus;
  micOpen: boolean;
  audioFrameCount: number;
  audioBufferByteLength: number;
  bufferedAudioDurationMs: number;
  lastAudioFrameAt: number | null;
  listeningActivityLevel: number;
  audioError: string | null;
  sttStatus: SttStatus;
  sttPartialTranscript: string;
  sttDraftDisplayText: string;
  sttDraftVisibleUntil: number | null;
  lastTranscriptAt: number | null;
  sttError: string | null;
  listeningSessionId: number;
  speechWindow: SpeechWindowState;
  reliability: ReliabilityDebugInfo;
  logs: string[];
};

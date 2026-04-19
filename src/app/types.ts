export type SpeakerSide = 'left' | 'right';
export type CodecCharacterId = 'snake' | 'otacon' | 'meryl' | 'colonel' | 'meiling';
export type CodecExpression = 'idle' | 'stern' | 'angry' | 'surprised' | 'thinking' | 'hurt';
export type CodecPortraitFamily = 'neutral' | 'alert';
export type CodecPortraitRuntimeFrameSlot = 'idle' | 'talk1' | 'talk2';
export type CodecPortraitSpecialFrameSlot = 'helmet' | 'closeup' | 'misc' | 'masked' | 'profile';
export type CodecPortraitFrameKey =
  | `${CodecCharacterId}.neutral.${CodecPortraitRuntimeFrameSlot}`
  | `${CodecCharacterId}.alert.${CodecPortraitRuntimeFrameSlot}`
  | `${CodecCharacterId}.special.${CodecPortraitSpecialFrameSlot}`;
export type CodecPortraitFrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type CodecTalkingMode = 'silent' | 'scripted_text' | 'live_audio';
export type SpeechWindowSource = 'none' | 'scripted_text' | 'live_audio';

export type DialogueLine = {
  speaker: SpeakerSide;
  text: string;
  emotion?: CodecExpression;
};

export type ScriptedTalkCadence = 'brief' | 'measured' | 'urgent' | 'staccato';

export type ScriptedLineMetadata = {
  speakerSide?: SpeakerSide;
  expression?: CodecExpression;
  cadence?: ScriptedTalkCadence;
  pauseAfterMs?: number;
  transitionIntensity?: 'low' | 'medium' | 'high';
};

export type ScriptedScenarioLine = {
  speaker: SpeakerSide;
  text: string;
  emotion?: CodecExpression;
  metadata?: ScriptedLineMetadata;
};

export type ScriptedScenario = {
  id: string;
  title: string;
  contactCharacterId: Exclude<CodecCharacterId, 'snake'>;
  lines: ScriptedScenarioLine[];
};

export type Contact = {
  name: string;
  code: string;
  frequency: string;
  portraitTag: string;
  characterId: CodecCharacterId;
  greeting: string;
  ackStyle: string;
  signoff: string;
  dialogue: DialogueLine[];
};

export type AppScreen = 'contacts' | 'incoming' | 'listening' | 'active' | 'ended' | 'debug';
export type ListeningMode = 'capture' | 'actions' | 'review';

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
  responseJobId?: number | null;
  streamState?: 'placeholder' | 'streaming' | 'complete' | 'failed';
};

export type SpeechWindowState = {
  isOpen: boolean;
  source: SpeechWindowSource;
  entryId: number | null;
  role: TranscriptEntry['role'] | null;
};

export type TurnState = 'idle' | 'awaiting_user' | 'processing_user' | 'responding' | 'complete' | 'error';
export type ResponseStatusPhase = 'standby' | 'sending' | 'receiving' | 'decrypting';

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
  listeningActionIndex: number;
  listeningMode: ListeningMode;
  listeningReviewOffset: number;
  activeActionIndex: number;
  endedActionIndex: number;
  dialogueIndex: number;
  activeTranscriptCursor: number;
  transcript: TranscriptEntry[];
  scriptedScenarioId: string | null;
  scriptedScenarioTitle: string | null;
  scriptedLineEntryIds: number[];
  scriptedLineMetadataByEntryId: Record<number, ScriptedLineMetadata>;
  scriptedAutoplay: boolean;
  turnState: TurnState;
  lastHandledUserTranscriptId: number | null;
  pendingResponseId: number | null;
  responseError: string | null;
  responseStatusPhase: ResponseStatusPhase | null;
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
  elapsedCaptureDurationMs: number;
  captureSessionStartedAt: number | null;
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

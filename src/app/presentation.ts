import type { AppState, ResponseStatusPhase, TranscriptEntry, TurnSendMode, TurnState } from './types';

const CANONICAL_TURN_LABELS: Record<TurnState, string> = {
  idle: 'Stand by',
  awaiting_user: 'Awaiting input',
  processing_user: 'Listening',
  responding: 'Response ready',
  complete: 'Stand by',
  error: 'Stand by',
};

export function getCanonicalTurnLabel(turnState: TurnState) {
  return CANONICAL_TURN_LABELS[turnState];
}

const RESPONSE_STATUS_LABELS: Record<ResponseStatusPhase, string> = {
  standby: 'Stand by',
  sending: 'Sending',
  receiving: 'Receiving',
  decrypting: 'Decrypting',
};

export function getResponseStatusLabel(responseStatusPhase: ResponseStatusPhase | null) {
  return responseStatusPhase ? RESPONSE_STATUS_LABELS[responseStatusPhase] : 'Stand by';
}

export function hasCommittedUserFinalTranscript(transcript: TranscriptEntry[]) {
  return transcript.some((entry) => entry.role === 'user' && entry.text.trim().length > 0);
}

export function shouldShowNoConfirmedSpeech(state: Pick<
  AppState,
  'transcript'
  | 'micOpen'
  | 'audioCaptureStatus'
  | 'sttStatus'
  | 'lastAudioFrameAt'
  | 'lastTranscriptAt'
  | 'audioFrameCount'
>) {
  if (hasCommittedUserFinalTranscript(state.transcript)) {
    return false;
  }

  const captureStopped = !state.micOpen
    && (state.audioCaptureStatus === 'closing' || state.audioCaptureStatus === 'idle')
    && (state.sttStatus === 'closing' || state.sttStatus === 'idle');

  const hasListeningEvidence = state.lastAudioFrameAt !== null
    || state.lastTranscriptAt !== null
    || state.audioFrameCount > 0;

  return captureStopped && hasListeningEvidence;
}

export function getVisibleSttDraft(state: Pick<
  AppState,
  'screen'
  | 'listeningMode'
  | 'listeningCaptureState'
  | 'listeningFailureKind'
  | 'listeningSessionReachedActiveCapture'
  | 'sttPartialTranscript'
  | 'sttDraftDisplayText'
  | 'sttDraftVisibleUntil'
>) {
  const partial = state.sttPartialTranscript.trim();
  const draftGraceActive = Boolean(
    !partial &&
    state.sttDraftDisplayText.trim() &&
    state.sttDraftVisibleUntil !== null &&
    Date.now() <= state.sttDraftVisibleUntil
  );
  const listeningDraftPinned = Boolean(
    !partial &&
    state.screen === 'listening' &&
    (state.listeningMode !== 'capture' || state.listeningCaptureState === 'paused') &&
    state.sttDraftDisplayText.trim()
  );

  return partial || (draftGraceActive || listeningDraftPinned ? state.sttDraftDisplayText.trim() : '');
}

export function isPauseActionable(state: Pick<
  AppState,
  'listeningMode'
  | 'listeningCaptureState'
  | 'listeningFailureKind'
  | 'listeningSessionReachedActiveCapture'
>) {
  return state.listeningMode === 'capture'
    && state.listeningCaptureState === 'capturing'
    && state.listeningSessionReachedActiveCapture
    && state.listeningFailureKind === null;
}

export function getTurnSendModeLabel(mode: TurnSendMode) {
  return mode === 'fast' ? 'Fast auto-send' : 'Review send';
}

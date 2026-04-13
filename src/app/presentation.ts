import type { AppState, TranscriptEntry, TurnState } from './types';

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

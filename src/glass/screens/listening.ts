import type { AppState, TranscriptEntry } from '../../app/types';
import {
  formatGlassSpeakerLine,
  getLatestTranscriptEntryByRole,
  getWrappedWindow,
  wrapTextLines,
  type GlassScreenView,
} from '../shared';

const MAX_CAPTURE_DURATION_MS = 10_000;

function formatCaptureCountdown(bufferedAudioDurationMs: number) {
  const remainingMs = Math.max(0, MAX_CAPTURE_DURATION_MS - bufferedAudioDurationMs);
  return `${(remainingMs / 1000).toFixed(1)}s left`;
}

function buildCaptureDialogue(state: AppState, visibleDraft: string) {
  const countdownLine = formatCaptureCountdown(state.bufferedAudioDurationMs);
  const transcriptLines = visibleDraft
    ? wrapTextLines(visibleDraft, 27)
    : [];
  const availableTranscriptLines = Math.max(0, 5 - 2);
  const visibleTranscriptLines = transcriptLines.slice(Math.max(0, transcriptLines.length - availableTranscriptLines));

  return [
    'You: (Recording...)',
    ...visibleTranscriptLines,
    countdownLine,
  ].join('\n');
}

function getVisibleDraft(state: AppState) {
  const partial = state.sttPartialTranscript.trim();
  const draftGraceActive = Boolean(
    !partial &&
    state.sttDraftDisplayText.trim() &&
    state.sttDraftVisibleUntil !== null &&
    Date.now() <= state.sttDraftVisibleUntil
  );

  return {
    partial,
    visibleDraft: partial || (draftGraceActive ? state.sttDraftDisplayText.trim() : ''),
  };
}

function getPendingUserEntry(state: AppState): TranscriptEntry | null {
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const entry = state.transcript[index];
    if (entry.role !== 'user') {
      continue;
    }

    if (state.lastHandledUserTranscriptId !== null && entry.id <= state.lastHandledUserTranscriptId) {
      continue;
    }

    return entry;
  }

  return getLatestTranscriptEntryByRole(state, ['user']);
}

export function buildListeningScreen(state: AppState): GlassScreenView {
  const { visibleDraft } = getVisibleDraft(state);
  const pendingUserEntry = getPendingUserEntry(state);
  const capturedText = pendingUserEntry?.text ?? visibleDraft;
  const reviewContent = formatGlassSpeakerLine({
    label: 'You',
    text: capturedText || '(Recording...)',
    maxLines: 12,
  });

  if (state.listeningMode === 'review' && capturedText) {
    const reviewWindow = getWrappedWindow({
      content: reviewContent,
      maxCharsPerLine: 27,
      maxLines: 4,
      offset: state.listeningReviewOffset,
    });

    return {
      screenLabel: '',
      statusLabel: '',
      portraitAsset: null,
      dialogue: reviewWindow.text,
      actions: [],
      selectedActionIndex: 0,
      mode: 'read',
      liveLineKind: 'none',
      showPortrait: false,
      showActions: false,
      dialogueCapturesInput: true,
    };
  }

  if (state.listeningMode === 'actions' && capturedText) {
    const actionWindow = getWrappedWindow({
      content: reviewContent,
      maxCharsPerLine: 27,
      maxLines: 3,
      offset: Number.MAX_SAFE_INTEGER,
    });

    return {
      screenLabel: '',
      statusLabel: '',
      portraitAsset: null,
      dialogue: actionWindow.text,
      actions: ['TRANSMIT', 'Retry'],
      selectedActionIndex: Math.min(state.listeningActionIndex, 1),
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: false,
      showActions: true,
    };
  }

  return {
    screenLabel: '',
    statusLabel: '',
    portraitAsset: null,
    dialogue: buildCaptureDialogue(state, visibleDraft),
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: false,
    dialogueCapturesInput: true,
  };
}

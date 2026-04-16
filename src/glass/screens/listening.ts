import type { AppState, TranscriptEntry } from '../../app/types';
import {
  formatGlassSpeakerLine,
  getLatestTranscriptEntryByRole,
  getRollingWrappedText,
  getWrappedWindow,
  shouldOfferReviewText,
  wrapText,
  type GlassScreenView,
} from '../shared';

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
  const { partial, visibleDraft } = getVisibleDraft(state);
  const pendingUserEntry = getPendingUserEntry(state);
  const capturedText = pendingUserEntry?.text ?? visibleDraft;
  const reviewContent = formatGlassSpeakerLine({
    label: 'YOU',
    text: capturedText || 'Speak when ready.',
    maxLines: 12,
  });
  const needsReview = Boolean(capturedText) && shouldOfferReviewText(reviewContent);

  if (state.listeningMode === 'review' && capturedText) {
    const reviewWindow = getWrappedWindow({
      content: reviewContent,
      maxCharsPerLine: 27,
      maxLines: 4,
      offset: state.listeningReviewOffset,
    });

    return {
      screenLabel: 'YOU',
      statusLabel: 'REVIEW TEXT',
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
      offset: 0,
    });

    return {
      screenLabel: 'YOU',
      statusLabel: 'READY',
      portraitAsset: null,
      dialogue: actionWindow.text,
      actions: needsReview ? ['TRANSMIT', 'RETRY', 'REVIEW TEXT'] : ['TRANSMIT', 'RETRY'],
      selectedActionIndex: state.listeningActionIndex,
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: false,
      showActions: true,
    };
  }

  const captureText = visibleDraft
    ? getRollingWrappedText(
      formatGlassSpeakerLine({
        label: 'YOU',
        text: visibleDraft,
        maxLines: 6,
        cursorVisible: partial.length > 0,
      }),
      27,
      3
    )
    : wrapText('Speak when ready.', 27, 2);

  return {
    screenLabel: 'YOU',
    statusLabel: 'SPEAK',
    portraitAsset: null,
    dialogue: captureText,
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: partial ? 'user' : 'none',
    showPortrait: false,
    showActions: false,
    dialogueCapturesInput: true,
  };
}

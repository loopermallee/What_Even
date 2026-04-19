import { getTurnSendModeLabel, getVisibleSttDraft } from '../../app/presentation';
import type { AppState, TranscriptEntry } from '../../app/types';
import { DEBUG_STT_COUNTDOWN } from '../../bridge/audio';
import {
  formatGlassSpeakerLine,
  getLatestTranscriptEntryByRole,
  getWrappedWindow,
  wrapTextLines,
  type GlassScreenView,
} from '../shared';

const MAX_CAPTURE_DURATION_MS = 10_000;
let lastCountdownSessionStartedAt: number | null = null;
let lastCountdownRemainingMs: number | null = null;

function getMonotonicRemainingMs(state: AppState) {
  const rawRemainingMs = Math.max(0, MAX_CAPTURE_DURATION_MS - state.elapsedCaptureDurationMs);
  const sessionStartedAt = state.captureSessionStartedAt;

  if (sessionStartedAt === null) {
    lastCountdownSessionStartedAt = null;
    lastCountdownRemainingMs = null;
    return rawRemainingMs;
  }

  if (lastCountdownSessionStartedAt !== sessionStartedAt) {
    lastCountdownSessionStartedAt = sessionStartedAt;
    lastCountdownRemainingMs = rawRemainingMs;
    return rawRemainingMs;
  }

  const guardedRemainingMs = lastCountdownRemainingMs === null
    ? rawRemainingMs
    : Math.min(rawRemainingMs, lastCountdownRemainingMs);
  lastCountdownRemainingMs = guardedRemainingMs;
  return guardedRemainingMs;
}

function formatCaptureCountdown(state: AppState) {
  const remainingMs = getMonotonicRemainingMs(state);
  if (DEBUG_STT_COUNTDOWN && remainingMs <= 1000 && state.captureSessionStartedAt !== null) {
    console.debug('[stt-countdown:render]', {
      listeningSessionId: state.listeningSessionId,
      captureSessionStartedAt: state.captureSessionStartedAt,
      elapsedCaptureDurationMs: state.elapsedCaptureDurationMs,
      remainingMs,
    });
  }

  return `${(remainingMs / 1000).toFixed(1)}s left`;
}

function buildCaptureDialogue(state: AppState, visibleDraft: string) {
  const countdownLine = formatCaptureCountdown(state);
  const modeLine = getTurnSendModeLabel(state.turnSendMode);
  const transcriptLines = visibleDraft
    ? wrapTextLines(visibleDraft, 27)
    : [];
  const availableTranscriptLines = Math.max(0, 5 - 3);
  const visibleTranscriptLines = transcriptLines.slice(Math.max(0, transcriptLines.length - availableTranscriptLines));

  return [
    modeLine,
    'You: (Recording...)',
    ...visibleTranscriptLines,
    countdownLine,
  ].join('\n');
}

function buildPausedDialogue(state: AppState, capturedText: string) {
  return formatGlassSpeakerLine({
    label: state.listeningMode === 'capture' ? 'Paused' : 'You',
    text: capturedText || 'Listening paused.',
    maxLines: 12,
  });
}

function getVisibleDraft(state: AppState) {
  return {
    partial: state.sttPartialTranscript.trim(),
    visibleDraft: getVisibleSttDraft(state),
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
  const reviewContent = state.listeningCaptureState === 'paused'
    ? buildPausedDialogue(state, capturedText)
    : formatGlassSpeakerLine({
      label: state.listeningMode === 'capture' ? getTurnSendModeLabel(state.turnSendMode) : 'You',
      text: capturedText || '(Recording...)',
      maxLines: 12,
    });

  if (state.listeningMode === 'capture' && state.listeningCaptureState === 'paused') {
    const actionWindow = getWrappedWindow({
      content: reviewContent,
      maxCharsPerLine: 27,
      maxLines: 3,
      offset: Number.MAX_SAFE_INTEGER,
    });
    const actions = capturedText
      ? ['RESUME', 'TRANSMIT', 'Retry']
      : ['RESUME', 'Retry'];

    return {
      screenLabel: '',
      statusLabel: '',
      portraitAsset: null,
      dialogue: actionWindow.text,
      actions,
      selectedActionIndex: Math.min(state.listeningActionIndex, actions.length - 1),
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: false,
      showActions: true,
    };
  }

  if ((state.listeningMode === 'actions' || state.listeningMode === 'review') && capturedText) {
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
    footerLabel: state.listeningCaptureState === 'capturing' ? 'Tap: Pause' : undefined,
  };
}

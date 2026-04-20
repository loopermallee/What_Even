import { getTurnSendModeLabel, getVisibleSttDraft, isPauseActionable } from '../../app/presentation';
import type { AppState, TranscriptEntry } from '../../app/types';
import { DEBUG_STT_COUNTDOWN } from '../../bridge/audio';
import {
  formatGlassSpeakerLine,
  getSelectedContact,
  getLatestTranscriptEntryByRole,
  getWrappedWindow,
  toSubtitleLines,
  wrapTextLines,
  type GlassScreenView,
} from '../shared';

const MAX_CAPTURE_DURATION_MS = 10_000;
let lastCountdownSessionStartedAt: number | null = null;
let lastCountdownRemainingMs: number | null = null;
const COUNTDOWN_RENDER_BUCKET_MS = 500;

function getMonotonicRemainingMs(state: AppState) {
  const rawRemainingMs = Math.max(0, MAX_CAPTURE_DURATION_MS - state.elapsedCaptureDurationMs);
  const sessionStartedAt = state.captureSessionStartedAt;

  if (sessionStartedAt === null || !state.listeningSessionReachedActiveCapture) {
    lastCountdownSessionStartedAt = null;
    lastCountdownRemainingMs = null;
    return null;
  }

  const bucketedRemainingMs = Math.ceil(rawRemainingMs / COUNTDOWN_RENDER_BUCKET_MS) * COUNTDOWN_RENDER_BUCKET_MS;

  if (lastCountdownSessionStartedAt !== sessionStartedAt) {
    lastCountdownSessionStartedAt = sessionStartedAt;
    lastCountdownRemainingMs = bucketedRemainingMs;
    return bucketedRemainingMs;
  }

  const guardedRemainingMs = lastCountdownRemainingMs === null
    ? bucketedRemainingMs
    : Math.min(bucketedRemainingMs, lastCountdownRemainingMs);
  lastCountdownRemainingMs = guardedRemainingMs;
  return guardedRemainingMs;
}

function formatCaptureCountdown(state: AppState) {
  const remainingMs = getMonotonicRemainingMs(state);
  if (remainingMs === null) {
    return null;
  }

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
    ...(countdownLine ? [countdownLine] : []),
  ].join('\n');
}

function buildConnectingDialogue() {
  return [
    'Speech standby',
    'Connecting service...',
    'Please hold.',
  ].join('\n');
}

function buildSpeechUnavailableDialogue(state: AppState) {
  return [
    'Speech unavailable',
    state.listeningFailureMessage || 'Service connection failed.',
    'Select Retry or Back.',
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
  const contact = getSelectedContact(state);
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

  if (state.listeningFailureKind === 'speech_unavailable') {
    const speechUnavailableDialogue = buildSpeechUnavailableDialogue(state);
    const actionWindow = getWrappedWindow({
      content: speechUnavailableDialogue,
      maxCharsPerLine: 27,
      maxLines: 3,
      offset: Number.MAX_SAFE_INTEGER,
    });
    const subtitleText = toSubtitleLines(speechUnavailableDialogue, 30, 2).join('\n');

    return {
      screenLabel: '',
      statusLabel: '',
      dialogue: actionWindow.text,
      topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  LISTEN`,
      centerReadoutText: 'SPEECH OFFLINE',
      subtitleText,
      actions: ['Retry', 'Back'],
      selectedActionIndex: Math.min(state.listeningActionIndex, 1),
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: true,
      showActions: true,
      centerModuleVariant: 'listening',
      actionMode: 'hidden-list',
      captureSurfaceMode: 'list',
    };
  }

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
    const subtitleText = toSubtitleLines(reviewContent, 30, 2).join('\n');

    return {
      screenLabel: '',
      statusLabel: '',
      dialogue: actionWindow.text,
      topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  REVIEW`,
      centerReadoutText: actions[state.listeningActionIndex] ?? actions[0],
      subtitleText,
      actions,
      selectedActionIndex: Math.min(state.listeningActionIndex, actions.length - 1),
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: true,
      showActions: true,
      centerModuleVariant: 'listening',
      actionMode: 'hidden-list',
      captureSurfaceMode: 'list',
    };
  }

  if ((state.listeningMode === 'actions' || state.listeningMode === 'review') && capturedText) {
    const actionWindow = getWrappedWindow({
      content: reviewContent,
      maxCharsPerLine: 27,
      maxLines: 3,
      offset: Number.MAX_SAFE_INTEGER,
    });
    const subtitleText = toSubtitleLines(reviewContent, 30, 2).join('\n');

    return {
      screenLabel: '',
      statusLabel: '',
      dialogue: actionWindow.text,
      topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  REVIEW`,
      centerReadoutText: 'TRANSMIT READY',
      subtitleText,
      actions: ['TRANSMIT', 'Retry'],
      selectedActionIndex: Math.min(state.listeningActionIndex, 1),
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: true,
      showActions: true,
      centerModuleVariant: 'listening',
      actionMode: 'hidden-list',
      captureSurfaceMode: 'list',
    };
  }

  if (
    state.listeningMode === 'capture' &&
    state.listeningCaptureState === 'capturing' &&
    !state.listeningSessionReachedActiveCapture
  ) {
    const connectingDialogue = buildConnectingDialogue();
    const subtitleText = toSubtitleLines(connectingDialogue, 30, 2).join('\n');

    return {
      screenLabel: '',
      statusLabel: '',
      dialogue: connectingDialogue,
      topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  LISTEN`,
      centerReadoutText: 'CONNECTING',
      subtitleText,
      actions: [],
      selectedActionIndex: 0,
      mode: 'compact',
      liveLineKind: 'none',
      showPortrait: true,
      showActions: false,
      centerModuleVariant: 'listening',
      actionMode: 'tap-only',
      captureSurfaceMode: 'text',
    };
  }

  const captureDialogue = buildCaptureDialogue(state, visibleDraft);
  const subtitleText = toSubtitleLines(captureDialogue, 30, 2).join('\n');

  return {
    screenLabel: '',
    statusLabel: '',
    dialogue: captureDialogue,
    topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  CAPTURE`,
    centerReadoutText: state.listeningSessionReachedActiveCapture ? 'REC ON' : 'REC WAIT',
    subtitleText,
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: false,
    dialogueCapturesInput: true,
    centerModuleVariant: 'listening',
    actionMode: 'tap-only',
    captureSurfaceMode: 'text',
    footerLabel: isPauseActionable(state) ? 'Tap: Pause' : undefined,
  };
}

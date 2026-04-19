import { ResponseOrchestrator } from './app/ai/responseOrchestrator';
import { DeterministicResponseProvider } from './app/ai/providers/deterministic';
import { GeminiResponseProvider } from './app/ai/providers/gemini';
import { OpenAIResponseProvider } from './app/ai/providers/openai';
import './style.css';
import { AppStore } from './app/state';
import { EvenBridgeApp } from './bridge/evenBridge';
import { AppGlasses } from './glass/AppGlasses';
import { AppWeb } from './web/AppWeb';
import type { AppState } from './app/types';

function parseFirstVisibleBudget(value: unknown, fallbackMs: number) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallbackMs;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }

  return parsed;
}

function getBridgeSyncSignature(state: AppState) {
  return JSON.stringify({
    screen: state.screen,
    screenBeforeDebug: state.screenBeforeDebug,
    turnSendMode: state.turnSendMode,
    selectedContactIndex: state.selectedContactIndex,
    listeningActionIndex: state.listeningActionIndex,
    listeningMode: state.listeningMode,
    listeningReviewOffset: state.listeningMode === 'review' ? state.listeningReviewOffset : null,
    activeActionIndex: state.activeActionIndex,
    endedActionIndex: state.endedActionIndex,
    dialogueIndex: state.dialogueIndex,
    activeTranscriptCursor: state.activeTranscriptCursor,
    transcriptTailIdBucket: state.transcript.length > 0 ? state.transcript[state.transcript.length - 1]?.id ?? null : null,
    turnState: state.turnState,
    lastHandledUserTranscriptId: state.lastHandledUserTranscriptId,
    pendingResponseId: state.pendingResponseId,
    responseError: state.responseError,
    responseStatusPhase: state.responseStatusPhase,
    responseStatusTimestampBucket: state.responseStatusTimestamp ? Math.floor(state.responseStatusTimestamp / 1000) : null,
    activeTranscriptTextBucket: state.activeTranscriptCursor >= 0
      ? state.transcript[state.activeTranscriptCursor]?.text.slice(0, 96) ?? null
      : null,
    speechWindowOpen: state.speechWindow.isOpen,
    speechWindowSource: state.speechWindow.source,
    speechWindowEntryId: state.speechWindow.entryId,
    speechWindowRole: state.speechWindow.role,
    started: state.started,
    audioCaptureStatus: state.audioCaptureStatus,
    sttStatus: state.sttStatus,
    sttPartialBucket: state.sttPartialTranscript ? state.sttPartialTranscript.slice(0, 64) : null,
    sttDraftVisible: state.sttDraftDisplayText.trim().length > 0
      && state.sttDraftVisibleUntil !== null
      && Date.now() <= state.sttDraftVisibleUntil,
    sttDraftBucket: state.sttDraftDisplayText ? state.sttDraftDisplayText.slice(0, 64) : null,
    sttError: state.sttError,
    micOpen: state.micOpen,
    elapsedCaptureDurationBucket: Math.floor(state.elapsedCaptureDurationMs / 100),
    audioActivityBucket: Math.floor(state.listeningActivityLevel * 10),
    audioFrameAtBucket: state.lastAudioFrameAt ? Math.floor(state.lastAudioFrameAt / 1000) : null,
    lastNormalizedInput: state.lastNormalizedInput,
    lastRawEventType: state.lastRawEvent?.rawEventTypeName ?? null,
  });
}

const store = new AppStore();
const responseOrchestrator = new ResponseOrchestrator(store, {
  providers: [
    {
      name: 'gemini',
      provider: new GeminiResponseProvider(),
      firstVisibleTimeoutMs: parseFirstVisibleBudget(import.meta.env.VITE_GEMINI_FIRST_VISIBLE_TIMEOUT_MS, 1200),
    },
    {
      name: 'openai',
      provider: new OpenAIResponseProvider(),
      firstVisibleTimeoutMs: parseFirstVisibleBudget(import.meta.env.VITE_OPENAI_FIRST_VISIBLE_TIMEOUT_MS, 1200),
    },
    {
      name: 'deterministic',
      provider: new DeterministicResponseProvider(),
      firstVisibleTimeoutMs: null,
    },
  ],
});
const glassesApp = new AppGlasses(store);
const bridgeApp = new EvenBridgeApp(store, glassesApp);

const webApp = new AppWeb({
  store,
  startOnEven: async (options?: { forceReset?: boolean }) => {
    await bridgeApp.startOnEven(options);
  },
});

let previousSignature = getBridgeSyncSignature(store.getState());
store.subscribe((next) => {
  const nextSignature = getBridgeSyncSignature(next);
  if (nextSignature !== previousSignature) {
    bridgeApp.queueSyncFromState();
  }

  previousSignature = nextSignature;
});

webApp.mount();

window.addEventListener('beforeunload', () => {
  responseOrchestrator.cleanup();
  bridgeApp.cleanup();
  webApp.cleanup();
});

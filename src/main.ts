import './style.css';
import { AppStore } from './app/state';
import { EvenBridgeApp } from './bridge/evenBridge';
import { AppGlasses } from './glass/AppGlasses';
import { AppWeb } from './web/AppWeb';
import type { AppState } from './app/types';

function getBridgeSyncSignature(state: AppState) {
  return JSON.stringify({
    screen: state.screen,
    screenBeforeDebug: state.screenBeforeDebug,
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
    responseStatusTimestampBucket: state.responseStatusTimestamp ? Math.floor(state.responseStatusTimestamp / 1000) : null,
    speechWindowOpen: state.speechWindow.isOpen,
    speechWindowSource: state.speechWindow.source,
    speechWindowEntryId: state.speechWindow.entryId,
    speechWindowRole: state.speechWindow.role,
    started: state.started,
    audioCaptureStatus: state.audioCaptureStatus,
    sttStatus: state.sttStatus,
    sttPartialBucket: state.sttPartialTranscript ? state.sttPartialTranscript.slice(0, 64) : null,
    sttError: state.sttError,
    micOpen: state.micOpen,
    audioDurationBucket: Math.floor(state.bufferedAudioDurationMs / 500),
    audioActivityBucket: Math.floor(state.listeningActivityLevel * 10),
    audioFrameAtBucket: state.lastAudioFrameAt ? Math.floor(state.lastAudioFrameAt / 1000) : null,
    lastNormalizedInput: state.lastNormalizedInput,
    lastRawEventType: state.lastRawEvent?.rawEventTypeName ?? null,
  });
}

const store = new AppStore();
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
  bridgeApp.cleanup();
  webApp.cleanup();
});

import './style.css';
import { AppStore } from './app/state';
import { createAudioScaffold } from './bridge/audio';
import { EvenBridgeApp } from './bridge/evenBridge';
import { AppGlasses } from './glass/AppGlasses';
import { AppWeb } from './web/AppWeb';
import type { AppState } from './app/types';

function getBridgeSyncSignature(state: AppState) {
  return JSON.stringify({
    screen: state.screen,
    screenBeforeDebug: state.screenBeforeDebug,
    selectedContactIndex: state.selectedContactIndex,
    incomingActionIndex: state.incomingActionIndex,
    activeActionIndex: state.activeActionIndex,
    endedActionIndex: state.endedActionIndex,
    dialogueIndex: state.dialogueIndex,
    started: state.started,
    lastNormalizedInput: state.lastNormalizedInput,
    lastRawEventType: state.lastRawEvent?.rawEventTypeName ?? null,
  });
}

const store = new AppStore();
const glassesApp = new AppGlasses(store);
const bridgeApp = new EvenBridgeApp(store, glassesApp);
const audioScaffold = createAudioScaffold();

if (import.meta.env.DEV) {
  store.log(`Audio scaffold ready (turnState=${audioScaffold.turnState}, micEnabled=${audioScaffold.micEnabled}).`);
}

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

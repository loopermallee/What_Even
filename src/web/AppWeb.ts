import { CONTACTS, RIGHT_CHARACTER } from '../app/contacts';
import { resolveCodecPortraitState, type CodecPortraitScene } from '../app/codecPortraitState';
import { getScriptedScenariosForContact } from '../app/scriptedScenarios';
import { AppStore } from '../app/state';
import type { AppState } from '../app/types';
import { resolveCodecPortraitFamily } from '../app/portraitExpression';
import {
  LifecycleRaceHarness,
  type LifecycleRaceScenarioId,
  type LifecycleRaceScenarioResult,
} from './dev/lifecycleRaceHarness';
import { renderDebugLog } from './components/DebugLog';
import { renderCodecPortrait } from './components/CodecPortrait';
import { renderSignalBars } from './components/SignalBars';
import { renderTranscriptPanel } from './components/TranscriptPanel';
import { CodecPortraitAnimator, type CodecPortraitAnimationFrame } from './lib/CodecPortraitAnimator';
import { syncCodecSpritePortraits } from './lib/codecSprites';
import { countWrappedLines } from '../glass/shared';

function mustQuery<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatFrameRect(frameRect: CodecPortraitAnimationFrame['left']['frameRect']) {
  if (!frameRect) {
    return '';
  }

  return `${frameRect.x},${frameRect.y},${frameRect.width},${frameRect.height}`;
}

type UserActionConfig = {
  primary: { id: string; label: string };
  secondary?: { id: string; label: string };
  tertiary?: { id: string; label: string };
};

type CodecAnimatedDomNodes = {
  leftFrame: HTMLElement | null;
  rightFrame: HTMLElement | null;
  leftFace: HTMLElement | null;
  rightFace: HTMLElement | null;
  signalBars: HTMLElement | null;
};

type FxDemoMode = 'live' | 'idle' | 'speaking' | 'transition';
type FxDemoSide = 'left' | 'right';
type CodecGlitchKind = 'connect' | 'switch' | 'interrupt';
type SignalPhase = 'flare' | 'decode' | 'settle';

type FxQueryState = {
  demoEnabled: boolean;
  debugEnabled: boolean;
  demoMode: FxDemoMode;
  demoSide: FxDemoSide;
};

type FxDebugSnapshot = {
  screen: AppState['screen'];
  started: boolean;
  hostDetected: boolean;
  speechWindow: AppState['speechWindow'];
  demo: {
    enabled: boolean;
    mode: FxDemoMode;
    side: FxDemoSide;
  };
  talkingMode: CodecPortraitAnimationFrame['talkingMode'];
  activeSpeakerSide: CodecPortraitScene['activeSpeakerSide'];
  barBucket: number;
  glitch: string;
  left: {
    active: boolean;
    expression: CodecPortraitAnimationFrame['left']['expression'];
    family: CodecPortraitAnimationFrame['left']['family'];
    frameKey: CodecPortraitAnimationFrame['left']['frameKey'];
    frameRect: CodecPortraitAnimationFrame['left']['frameRect'];
    usesManifestFrame: CodecPortraitAnimationFrame['left']['usesManifestFrame'];
    portraitState: 'idle' | 'speaking';
  };
  right: {
    active: boolean;
    expression: CodecPortraitAnimationFrame['right']['expression'];
    family: CodecPortraitAnimationFrame['right']['family'];
    frameKey: CodecPortraitAnimationFrame['right']['frameKey'];
    frameRect: CodecPortraitAnimationFrame['right']['frameRect'];
    usesManifestFrame: CodecPortraitAnimationFrame['right']['usesManifestFrame'];
    portraitState: 'idle' | 'speaking';
  };
  domHooks: {
    leftState: string | null;
    rightState: string | null;
    leftExpression: string | null;
    rightExpression: string | null;
    leftFamily: string | null;
    rightFamily: string | null;
    leftFrameKey: string | null;
    rightFrameKey: string | null;
    leftFrameRect: string | null;
    rightFrameRect: string | null;
    leftUsesManifest: string | null;
    rightUsesManifest: string | null;
  };
  layersMounted: {
    portraitFrames: number;
    portraitFaces: number;
    expressionLayers: number;
    eyesLayers: number;
    mouthLayers: number;
    radioLayers: number;
    staticOverlays: number;
    spriteCanvases: number;
  };
};

function parseFxDemoMode(value: string | null | undefined): FxDemoMode {
  if (value === 'idle' || value === 'speaking' || value === 'transition' || value === 'live') {
    return value;
  }

  return 'idle';
}

function parseFxDemoSide(value: string | null | undefined): FxDemoSide {
  return value === 'right' ? 'right' : 'left';
}

function readFxQueryState(): FxQueryState {
  if (typeof window === 'undefined') {
    return {
      demoEnabled: false,
      debugEnabled: false,
      demoMode: 'idle',
      demoSide: 'left',
    };
  }

  const search = new URLSearchParams(window.location.search);
  return {
    demoEnabled: search.get('fxdemo') === '1',
    debugEnabled: search.get('fxdebug') === '1',
    demoMode: parseFxDemoMode(search.get('fxmode')),
    demoSide: parseFxDemoSide(search.get('fxside')),
  };
}

function getUserActionConfig(state: AppState): UserActionConfig | null {
  const latestPendingUser = [...state.transcript].reverse().find((entry) => (
    entry.role === 'user' && (state.lastHandledUserTranscriptId === null || entry.id > state.lastHandledUserTranscriptId)
  )) ?? null;
  const shouldOfferReview = Boolean(
    latestPendingUser?.text && countWrappedLines(`YOU: ${latestPendingUser.text}`, 27) > 3
  );

  if (state.screen === 'contacts') {
    return {
      primary: { id: 'startCallBtn', label: 'Call' },
      secondary: { id: 'chooseContactBtn', label: 'Choose Contact' },
    };
  }

  if (state.screen === 'incoming') {
    return null;
  }

  if (state.screen === 'listening') {
    if (state.listeningMode === 'actions' && latestPendingUser) {
      return {
        primary: { id: 'continueBtn', label: 'Transmit' },
        secondary: { id: 'retryBtn', label: 'Retry' },
        tertiary: shouldOfferReview ? { id: 'reviewBtn', label: 'Review Text' } : undefined,
      };
    }

    if (state.listeningMode === 'review') {
      return {
        primary: { id: 'reviewExitBtn', label: 'Return' },
        secondary: { id: 'retryBtn', label: 'Retry' },
      };
    }

    return null;
  }

  if (state.screen === 'active') {
    return {
      primary: { id: 'nextBtn', label: 'Next' },
    };
  }

  if (state.screen === 'ended') {
    return {
      primary: { id: 'backBtn', label: 'Return' },
      secondary: { id: 'redialBtn', label: 'Redial' },
    };
  }

  return null;
}

function getScriptedSpeechWindowDurationMs(text: string) {
  const normalizedLength = text.trim().replace(/\s+/g, ' ').length;
  return Math.max(420, Math.min(2400, 220 + normalizedLength * 28));
}

function getRawStateSnapshot(state: AppState) {
  return {
    screen: state.screen,
    screenBeforeDebug: state.screenBeforeDebug,
    started: state.started,
    evenNativeHostDetected: state.evenNativeHostDetected,
    selectedContactIndex: state.selectedContactIndex,
    contact: CONTACTS[state.selectedContactIndex]?.name ?? 'Unknown',
    lifecycle: state.deviceLifecycleState,
    startup: {
      status: state.evenStartupStatus,
      blockedCode: state.evenStartupBlockedCode,
      blockedMessage: state.evenStartupBlockedMessage,
    },
    input: {
      normalized: state.lastNormalizedInput,
      raw: state.lastRawEvent,
    },
    audio: {
      micOpen: state.micOpen,
      captureStatus: state.audioCaptureStatus,
      frameCount: state.audioFrameCount,
      bufferBytes: state.audioBufferByteLength,
      bufferedMs: state.bufferedAudioDurationMs,
      lastFrameAt: state.lastAudioFrameAt,
      activityLevel: state.listeningActivityLevel,
      error: state.audioError,
    },
    stt: {
      status: state.sttStatus,
      partialTranscript: state.sttPartialTranscript,
      lastTranscriptAt: state.lastTranscriptAt,
      error: state.sttError,
      listeningSessionId: state.listeningSessionId,
    },
    turn: {
      state: state.turnState,
      lastHandledUserTranscriptId: state.lastHandledUserTranscriptId,
      pendingResponseId: state.pendingResponseId,
      responseError: state.responseError,
      responseStatusTimestamp: state.responseStatusTimestamp,
      activeTranscriptCursor: state.activeTranscriptCursor,
      transcriptLength: state.transcript.length,
    },
    speechWindow: state.speechWindow,
    reliability: state.reliability,
    imageSync: state.imageSync,
  };
}

function getLatestRuntimeError(state: AppState) {
  return state.responseError
    ?? state.sttError
    ?? state.audioError
    ?? state.evenStartupBlockedMessage
    ?? state.evenStartupBlockedCode
    ?? null;
}

export class AppWeb {
  private readonly store: AppStore;
  private readonly startOnEven: (options?: { forceReset?: boolean }) => Promise<void>;
  private readonly portraitAnimator: CodecPortraitAnimator;
  private unsubscribe: (() => void) | null = null;
  private readonly lifecycleRaceHarness: LifecycleRaceHarness;
  private readonly fxDemoEnabled: boolean;
  private readonly fxDebugEnabled: boolean;
  private contactPickerOpen = false;
  private debugDrawerOpen = false;
  private previousState: AppState | null = null;
  private activeCodecGlitch: CodecGlitchKind | null = null;
  private codecGlitchTimer: number | null = null;
  private signalPhase: SignalPhase | null = null;
  private signalPhaseTimer: number | null = null;
  private scriptedSpeechWindowTimer: number | null = null;
  private scriptedAutoplayTimer: number | null = null;
  private scheduledSpeechWindowEntryId: number | null = null;
  private readonly scriptedScenarioSelectionByContact = new Map<number, string>();
  private fxDemoMode: FxDemoMode;
  private fxDemoSide: FxDemoSide;
  private lastRenderedState: AppState | null = null;
  private lastRenderedScene: CodecPortraitScene | null = null;
  private lastEffectiveGlitch: CodecGlitchKind | null = null;
  private webOutgoingAdvanceTimer: number | null = null;
  private animatedNodes: CodecAnimatedDomNodes = {
    leftFrame: null,
    rightFrame: null,
    leftFace: null,
    rightFace: null,
    signalBars: null,
  };

  constructor(options: {
    store: AppStore;
    startOnEven: (options?: { forceReset?: boolean }) => Promise<void>;
  }) {
    const fxQueryState = readFxQueryState();
    this.store = options.store;
    this.startOnEven = options.startOnEven;
    this.fxDemoEnabled = fxQueryState.demoEnabled;
    this.fxDebugEnabled = fxQueryState.debugEnabled;
    this.fxDemoMode = fxQueryState.demoMode;
    this.fxDemoSide = fxQueryState.demoSide;
    this.portraitAnimator = new CodecPortraitAnimator({
      onUpdate: (frame) => {
        this.applyAnimatedPortraitFrame(frame);
      },
    });
    this.lifecycleRaceHarness = new LifecycleRaceHarness({
      store: this.store,
      onUpdate: () => {
        this.render(this.store.getState());
      },
    });
  }

  mount() {
    const app = mustQuery<HTMLDivElement>('#app');
    app.innerHTML = '<div id="webRoot"></div>';

    this.unsubscribe = this.store.subscribe((state) => {
      if (state.screen !== 'contacts') {
        this.contactPickerOpen = false;
      }
      this.syncWebOutgoingAdvance(state);
      this.render(state);
    });

    this.render(this.store.getState());
    this.store.log('Web companion ready.');
  }

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.codecGlitchTimer !== null) {
      window.clearTimeout(this.codecGlitchTimer);
      this.codecGlitchTimer = null;
    }
    if (this.signalPhaseTimer !== null) {
      window.clearTimeout(this.signalPhaseTimer);
      this.signalPhaseTimer = null;
    }

    this.clearSpeechWindowTimer();
    this.clearScriptedAutoplayTimer();
    if (this.webOutgoingAdvanceTimer !== null) {
      window.clearTimeout(this.webOutgoingAdvanceTimer);
      this.webOutgoingAdvanceTimer = null;
    }
    this.portraitAnimator.destroy();
    this.animatedNodes = {
      leftFrame: null,
      rightFrame: null,
      leftFace: null,
      rightFace: null,
      signalBars: null,
    };
    this.store.cancelSpeechWindow();
  }

  private render(state: AppState) {
    const nextGlitch = this.getCodecGlitchEvent(this.previousState, state);
    if (nextGlitch) {
      this.triggerCodecGlitch(nextGlitch);
      this.triggerSignalPhases();
    }

    const root = mustQuery<HTMLDivElement>('#webRoot');
    const baseScene = resolveCodecPortraitState(state);
    this.syncScriptedSpeechWindowTimer(state, baseScene);
    const scene = this.getEffectivePortraitScene(baseScene);
    this.syncScriptedAutoplay(state, scene);
    this.portraitAnimator.setScene(scene);
    const animationFrame = this.portraitAnimator.getSnapshot();
    const effectiveGlitch = this.getEffectiveCodecGlitch();
    this.lastRenderedState = state;
    this.lastRenderedScene = scene;
    this.lastEffectiveGlitch = effectiveGlitch;

    root.innerHTML = state.screen === 'debug'
      ? this.renderDebugView(state)
      : this.renderUserView(state, scene, animationFrame, effectiveGlitch);

    if (state.screen === 'debug') {
      this.lastRenderedScene = null;
      this.lastEffectiveGlitch = null;
      this.animatedNodes = {
        leftFrame: null,
        rightFrame: null,
        leftFace: null,
        rightFace: null,
        signalBars: null,
      };
    } else {
      syncCodecSpritePortraits(root);
      this.captureAnimatedNodes(root);
      this.applyAnimatedPortraitFrame(animationFrame);
      this.syncFxDebugReadout(root, state, scene, animationFrame, effectiveGlitch);
    }
    this.bindControls(state);
    this.bindLifecycleHarnessControls();
    this.previousState = state;
  }

  private syncWebOutgoingAdvance(state: AppState) {
    if (state.started || state.screen !== 'incoming') {
      if (this.webOutgoingAdvanceTimer !== null) {
        window.clearTimeout(this.webOutgoingAdvanceTimer);
        this.webOutgoingAdvanceTimer = null;
      }
      return;
    }

    if (this.webOutgoingAdvanceTimer !== null) {
      return;
    }

    this.webOutgoingAdvanceTimer = window.setTimeout(() => {
      this.webOutgoingAdvanceTimer = null;
      const currentState = this.store.getState();
      if (!currentState.started && currentState.screen === 'incoming') {
        this.store.presentOutboundGreeting();
      }
    }, 1100);
  }

  private getCodecGlitchEvent(
    previousState: AppState | null,
    state: AppState,
  ): CodecGlitchKind | null {
    if (!previousState || state.screen === 'debug') {
      return null;
    }

    if (previousState.selectedContactIndex !== state.selectedContactIndex) {
      return 'switch';
    }

    if (previousState.responseError !== state.responseError && Boolean(state.responseError)) {
      return 'interrupt';
    }

    if (previousState.screen !== 'incoming' && state.screen === 'incoming') {
      return 'connect';
    }

    if ((previousState.screen === 'incoming' || previousState.screen === 'listening') && state.screen === 'active') {
      return 'connect';
    }

    return null;
  }

  private triggerCodecGlitch(kind: CodecGlitchKind) {
    this.activeCodecGlitch = kind;

    if (this.codecGlitchTimer !== null) {
      window.clearTimeout(this.codecGlitchTimer);
    }

    const durationMs = kind === 'interrupt' ? 260 : 180;
    this.codecGlitchTimer = window.setTimeout(() => {
      this.activeCodecGlitch = null;
      this.codecGlitchTimer = null;
      this.render(this.store.getState());
    }, durationMs);
  }

  private triggerSignalPhases() {
    if (this.signalPhaseTimer !== null) {
      window.clearTimeout(this.signalPhaseTimer);
      this.signalPhaseTimer = null;
    }

    this.signalPhase = 'flare';
    window.setTimeout(() => {
      this.signalPhase = 'decode';
      this.render(this.store.getState());
      this.signalPhaseTimer = window.setTimeout(() => {
        this.signalPhase = 'settle';
        this.render(this.store.getState());
        this.signalPhaseTimer = window.setTimeout(() => {
          this.signalPhase = null;
          this.signalPhaseTimer = null;
          this.render(this.store.getState());
        }, 180);
      }, 260);
    }, 90);
  }

  private getEffectivePortraitScene(scene: CodecPortraitScene): CodecPortraitScene {
    if (!this.fxDemoEnabled || this.fxDemoMode === 'live') {
      return scene;
    }

    const demoLeftActive = this.fxDemoSide === 'left';
    const demoRightActive = this.fxDemoSide === 'right';
    const demoExpression = this.fxDemoMode === 'transition'
      ? 'surprised'
      : this.fxDemoMode === 'speaking'
        ? 'stern'
        : 'idle';
    const demoStateLabel = this.fxDemoMode === 'transition'
      ? 'FX TRANSITION'
      : this.fxDemoMode === 'speaking'
        ? 'FX SPEAKING'
        : 'FX IDLE';
    const demoSpeakerLabel = demoLeftActive
      ? scene.left.label
      : scene.right.label;
    const demoLine = this.fxDemoMode === 'transition'
      ? 'FX demo holds the stronger transition state so you can verify burst and static escalation.'
      : this.fxDemoMode === 'speaking'
        ? 'FX demo forces scripted speaking so stepped sprite swaps and quantized bars stay visible in a regular browser.'
        : 'FX demo holds an idle portrait so restrained motion remains visible without host or STT activity.';
    const demoLeftExpression = demoLeftActive ? demoExpression : 'idle';
    const demoRightExpression = demoRightActive
      ? (this.fxDemoMode === 'transition' ? 'angry' : 'stern')
      : 'stern';

    return {
      ...scene,
      stateLabel: demoStateLabel,
      speakerLabel: demoSpeakerLabel,
      currentLine: demoLine,
      previousLine: this.fxDemoMode === 'idle'
        ? 'Browser-safe verification path active.'
        : scene.previousLine,
      activeSpeakerSide: this.fxDemoSide,
      talkingMode: this.fxDemoMode === 'idle' ? 'silent' : 'scripted_text',
      currentEntryId: null,
      currentRole: demoLeftActive ? 'contact' : 'user',
      signalBarBase: this.fxDemoMode === 'transition' ? 8 : this.fxDemoMode === 'speaking' ? 6 : 3,
      listeningActivityLevel: 0,
      left: {
        ...scene.left,
        active: demoLeftActive,
        expression: demoLeftExpression,
        family: resolveCodecPortraitFamily(demoLeftExpression),
        role: demoLeftActive ? 'contact' : null,
        entryId: null,
      },
      right: {
        ...scene.right,
        active: demoRightActive,
        expression: demoRightExpression,
        family: resolveCodecPortraitFamily(demoRightExpression),
        role: demoRightActive ? 'user' : null,
        entryId: null,
      },
    };
  }

  private getEffectiveCodecGlitch() {
    if (this.fxDemoEnabled && this.fxDemoMode === 'transition') {
      return 'connect' as const;
    }

    return this.activeCodecGlitch;
  }

  private updateFxQueryState() {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (this.fxDemoEnabled) {
      url.searchParams.set('fxdemo', '1');
      url.searchParams.set('fxmode', this.fxDemoMode);
      url.searchParams.set('fxside', this.fxDemoSide);
    }

    if (this.fxDebugEnabled) {
      url.searchParams.set('fxdebug', '1');
    }

    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  private renderFxPanels() {
    if (!this.fxDemoEnabled && !this.fxDebugEnabled) {
      return '';
    }

    const modeButton = (mode: FxDemoMode, label: string) => `
      <button
        type="button"
        class="fx-chip ${this.fxDemoMode === mode ? 'fx-chip-active' : ''}"
        data-fx-demo-mode="${mode}"
      >${label}</button>
    `;
    const sideButton = (side: FxDemoSide, label: string) => `
      <button
        type="button"
        class="fx-chip ${this.fxDemoSide === side ? 'fx-chip-active' : ''}"
        data-fx-demo-side="${side}"
      >${label}</button>
    `;

    return `
      <div class="fx-tools">
        ${this.fxDemoEnabled ? `
          <section class="fx-panel fx-panel-demo" aria-label="Portrait FX demo">
            <div class="fx-panel-head">
              <span class="section-label">FX Demo</span>
              <strong>${escapeHtml(this.fxDemoMode.toUpperCase())}</strong>
            </div>
            <div class="fx-chip-row">
              ${modeButton('live', 'Live')}
              ${modeButton('idle', 'Idle')}
              ${modeButton('speaking', 'Speaking')}
              ${modeButton('transition', 'Transition')}
            </div>
            <div class="fx-chip-row">
              ${sideButton('left', 'Contact')}
              ${sideButton('right', 'User')}
            </div>
          </section>
        ` : ''}
        ${this.fxDebugEnabled ? `
          <section class="fx-panel fx-panel-debug" aria-label="Portrait FX debug">
            <div class="fx-panel-head">
              <span class="section-label">FX Debug</span>
              <strong>Live State</strong>
            </div>
            <pre id="fxDebugReadout" class="fx-debug-readout"></pre>
          </section>
        ` : ''}
      </div>
    `;
  }

  private syncFxDebugReadout(
    root: ParentNode,
    state: AppState,
    scene: CodecPortraitScene,
    animationFrame: CodecPortraitAnimationFrame,
    effectiveGlitch: CodecGlitchKind | null,
  ) {
    if (!this.fxDebugEnabled) {
      return;
    }

    const readout = root.querySelector<HTMLPreElement>('#fxDebugReadout');
    if (!readout) {
      return;
    }

    const leftFace = root.querySelector<HTMLElement>('.codec-portrait-bay-left .portrait-face');
    const rightFace = root.querySelector<HTMLElement>('.codec-portrait-bay-right .portrait-face');
    const snapshot: FxDebugSnapshot = {
      screen: state.screen,
      started: state.started,
      hostDetected: state.evenNativeHostDetected,
      speechWindow: state.speechWindow,
      demo: {
        enabled: this.fxDemoEnabled,
        mode: this.fxDemoMode,
        side: this.fxDemoSide,
      },
      talkingMode: animationFrame.talkingMode,
      activeSpeakerSide: scene.activeSpeakerSide,
      barBucket: animationFrame.barBucket,
      glitch: effectiveGlitch ?? 'none',
      left: {
        active: animationFrame.left.active,
        expression: animationFrame.left.expression,
        family: animationFrame.left.family,
        frameKey: animationFrame.left.frameKey,
        frameRect: animationFrame.left.frameRect,
        usesManifestFrame: animationFrame.left.usesManifestFrame,
        portraitState: animationFrame.left.portraitState,
      },
      right: {
        active: animationFrame.right.active,
        expression: animationFrame.right.expression,
        family: animationFrame.right.family,
        frameKey: animationFrame.right.frameKey,
        frameRect: animationFrame.right.frameRect,
        usesManifestFrame: animationFrame.right.usesManifestFrame,
        portraitState: animationFrame.right.portraitState,
      },
      domHooks: {
        leftState: leftFace?.dataset.portraitState ?? null,
        rightState: rightFace?.dataset.portraitState ?? null,
        leftExpression: leftFace?.dataset.portraitExpression ?? null,
        rightExpression: rightFace?.dataset.portraitExpression ?? null,
        leftFamily: leftFace?.dataset.portraitFamily ?? null,
        rightFamily: rightFace?.dataset.portraitFamily ?? null,
        leftFrameKey: leftFace?.dataset.codecSpriteFrameKey ?? null,
        rightFrameKey: rightFace?.dataset.codecSpriteFrameKey ?? null,
        leftFrameRect: leftFace?.dataset.codecSpriteFrameRect ?? null,
        rightFrameRect: rightFace?.dataset.codecSpriteFrameRect ?? null,
        leftUsesManifest: leftFace?.dataset.codecSpriteUsesManifest ?? null,
        rightUsesManifest: rightFace?.dataset.codecSpriteUsesManifest ?? null,
      },
      layersMounted: {
        portraitFrames: root.querySelectorAll('.portrait-frame').length,
        portraitFaces: root.querySelectorAll('.portrait-face').length,
        expressionLayers: root.querySelectorAll('.portrait-expression-layer').length,
        eyesLayers: root.querySelectorAll('.portrait-eyes-layer').length,
        mouthLayers: root.querySelectorAll('.portrait-mouth-layer').length,
        radioLayers: root.querySelectorAll('.portrait-radio-layer').length,
        staticOverlays: root.querySelectorAll('.portrait-static-overlay').length,
        spriteCanvases: root.querySelectorAll('.codec-sprite-canvas').length,
      },
    };

    readout.textContent = JSON.stringify(snapshot, null, 2);
    (window as Window & { __WHAT_EVEN_FX__?: FxDebugSnapshot }).__WHAT_EVEN_FX__ = snapshot;
  }

  private renderUserView(
    state: AppState,
    scene: CodecPortraitScene,
    animationFrame: CodecPortraitAnimationFrame,
    effectiveGlitch: CodecGlitchKind | null,
  ) {
    const contact = CONTACTS[state.selectedContactIndex];
    const actions = getUserActionConfig(state);
    const pickerVisible = state.screen === 'contacts' && this.contactPickerOpen;
    const transcriptTitle = state.screen === 'contacts' ? 'Recent Exchange' : 'Conversation Log';
    const latestError = getLatestRuntimeError(state);
    const isSpeaking = animationFrame.talkingMode !== 'silent';
    const surfaceMode = state.screen === 'contacts'
      ? 'Memory selector'
      : state.screen === 'incoming'
        ? 'Outbound handshake'
        : state.screen === 'listening'
          ? state.listeningMode === 'review'
            ? 'Review text'
            : state.listeningMode === 'actions'
              ? 'Transmit review'
              : 'Live capture'
          : state.screen === 'active'
            ? 'Caller response'
            : 'Link closed';
    const leftPortrait = renderCodecPortrait({
      label: contact.name.toUpperCase(),
      tag: contact.portraitTag,
      characterId: contact.characterId,
      active: animationFrame.left.active,
      portraitState: animationFrame.left.portraitState,
      expression: animationFrame.left.expression,
      family: animationFrame.left.family,
      frameKey: animationFrame.left.frameKey,
      frameRect: animationFrame.left.frameRect,
      usesManifestFrame: animationFrame.left.usesManifestFrame,
    });
    const rightPortrait = renderCodecPortrait({
      label: RIGHT_CHARACTER.name.toUpperCase(),
      tag: RIGHT_CHARACTER.portraitTag,
      characterId: RIGHT_CHARACTER.characterId,
      active: animationFrame.right.active,
      portraitState: animationFrame.right.portraitState,
      expression: animationFrame.right.expression,
      family: animationFrame.right.family,
      frameKey: animationFrame.right.frameKey,
      frameRect: animationFrame.right.frameRect,
      usesManifestFrame: animationFrame.right.usesManifestFrame,
    });

    return `
      <div class="wrap">
        <div class="companion-header companion-header-compact">
          <div class="companion-identity">
            <p class="eyebrow">Companion App</p>
            <div class="companion-title-row">
              <h1>What Even</h1>
              <span class="companion-mode-pill">${escapeHtml(surfaceMode)}</span>
            </div>
          </div>
          <div class="header-actions">
            <span class="host-status-chip ${state.evenNativeHostDetected ? '' : 'host-status-chip-warning'}">
              ${state.evenNativeHostDetected ? 'Host linked' : 'Host unavailable'}
            </span>
            <button
              id="startEvenBtn"
              class="header-button ${state.evenNativeHostDetected ? '' : 'header-button-disabled'}"
              title="${state.evenNativeHostDetected ? 'Start on Even' : 'Requires the Even app native host'}"
            >${state.started ? 'Restart on Even' : 'Start on Even'}</button>
          </div>
        </div>

        <section class="codec-stage">
          <div class="codec-machine ${effectiveGlitch ? `codec-glitch-${effectiveGlitch}` : ''} ${this.signalPhase ? `codec-signal-phase-${this.signalPhase}` : ''} ${this.fxDemoEnabled && this.fxDemoMode === 'transition' ? 'fx-demo-transition' : ''} ${isSpeaking ? 'codec-machine-speaking' : 'codec-machine-idle'}">
            <div class="codec-transmission-layers" aria-hidden="true">
              <div class="codec-noise-layer"></div>
              <div class="codec-crt-layer"></div>
              <div class="scanlines"></div>
              <div class="codec-glitch-layer"></div>
            </div>

            <div class="codec-status-strip">
              <div class="codec-status-cell">
                <span class="section-label">Contact</span>
                <strong>${escapeHtml(contact.name)}</strong>
                <span>${escapeHtml(contact.code)} · ${escapeHtml(contact.frequency)}</span>
              </div>
              <div class="codec-status-cell codec-status-cell-center">
                <span class="section-label">Channel</span>
                <strong>${escapeHtml(scene.stateLabel)}</strong>
                <span>${escapeHtml(scene.speakerLabel)}</span>
              </div>
              <div class="codec-status-cell codec-status-cell-right">
                <span class="section-label">Bridge</span>
                <strong>${state.started ? 'Armed' : 'Standby'}</strong>
                <span>${state.evenNativeHostDetected ? 'Glasses sync ready' : 'Browser-only session'}</span>
              </div>
            </div>

            <div class="codec-machine-top">
              <div class="codec-portrait-bay codec-portrait-bay-left">
                ${leftPortrait}
                <div class="codec-portrait-meta">
                  <strong>${escapeHtml(contact.name)}</strong>
                  <span>${escapeHtml(contact.code)} · ${escapeHtml(contact.frequency)}</span>
                </div>
              </div>

              <div class="codec-center-core" aria-label="Codec signal module">
                <div class="codec-center-cap">PTT</div>
                <div class="signal-screen">
                  <div class="signal-screen-grid">
                    <div class="signal-bars">${renderSignalBars(animationFrame.barBucket)}</div>
                    <div class="frequency-stack">
                      <span class="signal-label">TUNE</span>
                      <strong>${escapeHtml(contact.frequency)}</strong>
                      <span class="signal-subtitle">${escapeHtml(scene.stateLabel)}</span>
                    </div>
                  </div>
                </div>
                <div class="codec-center-cap bottom">${escapeHtml(scene.speakerLabel)}</div>
              </div>

              <div class="codec-portrait-bay codec-portrait-bay-right">
                ${rightPortrait}
                <div class="codec-portrait-meta codec-portrait-meta-user">
                  <strong>${escapeHtml(RIGHT_CHARACTER.name)}</strong>
                  <span>Codec companion ready</span>
                </div>
              </div>
            </div>

            <div class="codec-comms-stack">
              <div class="codec-dialogue-deck">
                <div class="codec-dialogue-head codec-dialogue-head-compact">
                  <div>
                    <span class="section-label">Live Dialogue</span>
                    <div class="codec-dialogue-speaker-row">
                      <span class="dialogue-speaker">${escapeHtml(scene.speakerLabel)}</span>
                      <span class="dialogue-frequency">FREQ ${escapeHtml(contact.frequency)}</span>
                    </div>
                  </div>
                  <span class="codec-state-pill">${escapeHtml(scene.stateLabel)}</span>
                </div>
                <div class="dialogue-current-line">${escapeHtml(scene.currentLine)}</div>
                ${scene.previousLine ? `<div class="dialogue-previous-line">${escapeHtml(scene.previousLine)}</div>` : ''}
              </div>

              <div class="codec-transcript-deck">
                <div class="codec-transcript-head">
                  <div>
                    <div class="section-label">Transcript</div>
                    <h2>${transcriptTitle}</h2>
                  </div>
                  <span class="codec-line-index">Latest 6 lines</span>
                </div>

                <div class="transcript-history codec-transcript-history">
                  ${renderTranscriptPanel(state.transcript, { partialText: state.sttPartialTranscript })}
                </div>
              </div>
            </div>

            ${actions ? `
              <div class="codec-action-row">
                <button id="${actions.primary.id}" class="primary-action codec-action-button">${actions.primary.label}</button>
                ${actions.secondary ? `<button id="${actions.secondary.id}" class="secondary-action codec-action-button">${actions.secondary.label}</button>` : ''}
                ${actions.tertiary ? `<button id="${actions.tertiary.id}" class="secondary-action codec-action-button">${actions.tertiary.label}</button>` : ''}
              </div>
            ` : ''}
          </div>
        </section>

        <div class="debug-drawer-anchor ${this.debugDrawerOpen ? 'debug-drawer-anchor-open' : ''}">
          ${this.debugDrawerOpen ? `
            <section id="debugDrawerPanel" class="debug-drawer-panel" aria-label="Troubleshooting drawer">
              <div class="debug-drawer-header">
                <div>
                  <div class="section-label">Troubleshooting</div>
                  <h2>Runtime Status</h2>
                </div>
                <div class="debug-drawer-actions">
                  ${import.meta.env.DEV ? '<button id="toggleDebugBtn" class="debug-drawer-action">Full Debug</button>' : ''}
                  <button id="copyLogBtn" class="debug-drawer-action">Copy Log</button>
                  <button id="clearLogBtn" class="debug-drawer-action">Clear Log</button>
                  <button id="debugDrawerCloseBtn" class="debug-drawer-action">Close</button>
                </div>
              </div>

              <div class="debug-summary-grid">
                <div class="debug-summary-item">
                  <span class="section-label">Native Host</span>
                  <strong>${state.evenNativeHostDetected ? 'Detected' : 'Missing'}</strong>
                </div>
                <div class="debug-summary-item">
                  <span class="section-label">Startup</span>
                  <strong>${escapeHtml(state.evenStartupStatus)}</strong>
                </div>
                <div class="debug-summary-item">
                  <span class="section-label">Screen</span>
                  <strong>${escapeHtml(state.screen)}</strong>
                </div>
                <div class="debug-summary-item">
                  <span class="section-label">Mic</span>
                  <strong>${state.micOpen ? 'Open' : 'Closed'}</strong>
                </div>
                <div class="debug-summary-item">
                  <span class="section-label">STT</span>
                  <strong>${escapeHtml(state.sttStatus)}</strong>
                </div>
                <div class="debug-summary-item">
                  <span class="section-label">Startup Blocked</span>
                  <strong>${escapeHtml(state.evenStartupBlockedCode ?? 'none')}</strong>
                </div>
                <div class="debug-summary-item debug-summary-item-wide">
                  <span class="section-label">Latest Error</span>
                  <strong>${escapeHtml(latestError ?? 'none')}</strong>
                </div>
                <div class="debug-summary-item debug-summary-item-wide">
                  <span class="section-label">Recent Log Count</span>
                  <strong>${state.logs.length}</strong>
                </div>
              </div>

              ${renderDebugLog(state.logs, {
                title: 'Recent Log',
                className: 'log-card log-card-compact',
                emptyLabel: 'No recent log lines yet.',
              })}
            </section>
          ` : ''}

          <button
            id="debugDrawerToggleBtn"
            class="debug-drawer-trigger ${this.debugDrawerOpen ? 'debug-drawer-trigger-open' : ''}"
            aria-expanded="${this.debugDrawerOpen ? 'true' : 'false'}"
            aria-controls="debugDrawerPanel"
          >
            <span>Status</span>
            <span>${state.evenStartupStatus}</span>
            <span>${state.sttStatus}</span>
            <span>${state.logs.length} logs</span>
          </button>
        </div>

        ${pickerVisible ? `
          <div class="picker-sheet-backdrop" id="contactPickerDismissBtn"></div>
          <div class="picker-sheet">
            <div class="picker-sheet-header">
              <div>
                <div class="section-label">Choose Contact</div>
                <h2>Codec Directory</h2>
              </div>
              <button id="contactPickerDismissBtnSecondary" class="picker-close-button">Close</button>
            </div>
            <label class="picker-card" for="contactPicker">
              <span class="picker-help">Tune the companion to the right contact before starting the link.</span>
              <select id="contactPicker" class="contact-picker">
                ${CONTACTS.map((item, index) => `
                  <option value="${index}" ${index === state.selectedContactIndex ? 'selected' : ''}>
                    ${escapeHtml(item.name)} (${escapeHtml(item.frequency)})
                  </option>
                `).join('')}
              </select>
            </label>
          </div>
        ` : ''}
        ${this.renderFxPanels()}
      </div>
    `;
  }

  private syncScriptedSpeechWindowTimer(state: AppState, scene: CodecPortraitScene) {
    if (
      state.screen === 'debug'
      || !state.speechWindow.isOpen
      || state.speechWindow.source !== 'scripted_text'
      || state.speechWindow.entryId === null
    ) {
      this.clearSpeechWindowTimer();
      return;
    }

    if (this.scheduledSpeechWindowEntryId === state.speechWindow.entryId) {
      return;
    }

    this.clearSpeechWindowTimer();
    this.scheduledSpeechWindowEntryId = state.speechWindow.entryId;
    this.scriptedSpeechWindowTimer = window.setTimeout(() => {
      this.scriptedSpeechWindowTimer = null;
      const currentState = this.store.getState();
      if (
        currentState.speechWindow.isOpen
        && currentState.speechWindow.source === 'scripted_text'
        && currentState.speechWindow.entryId === state.speechWindow.entryId
      ) {
        this.store.closeSpeechWindow();
      }
    }, getScriptedSpeechWindowDurationMs(scene.currentLine));
  }

  private clearSpeechWindowTimer() {
    if (this.scriptedSpeechWindowTimer !== null) {
      window.clearTimeout(this.scriptedSpeechWindowTimer);
      this.scriptedSpeechWindowTimer = null;
    }

    this.scheduledSpeechWindowEntryId = null;
  }

  private clearScriptedAutoplayTimer() {
    if (this.scriptedAutoplayTimer !== null) {
      window.clearTimeout(this.scriptedAutoplayTimer);
      this.scriptedAutoplayTimer = null;
    }
  }

  private syncScriptedAutoplay(state: AppState, scene: CodecPortraitScene) {
    if (
      !state.scriptedAutoplay
      || state.screen !== 'active'
      || !state.scriptedScenarioId
      || state.activeTranscriptCursor < 0
    ) {
      this.clearScriptedAutoplayTimer();
      return;
    }

    const activeEntry = state.transcript[state.activeTranscriptCursor] ?? null;
    if (!activeEntry || this.scriptedAutoplayTimer !== null) {
      return;
    }

    const scriptedIndex = state.scriptedLineEntryIds.findIndex((id) => id === activeEntry.id);
    const nextId = scriptedIndex >= 0 ? state.scriptedLineEntryIds[scriptedIndex + 1] ?? null : null;
    if (nextId === null) {
      this.clearScriptedAutoplayTimer();
      return;
    }

    const pauseAfterMs = scene.currentLineMetadata?.pauseAfterMs ?? 220;
    const delayMs = getScriptedSpeechWindowDurationMs(scene.currentLine) + pauseAfterMs;
    this.scriptedAutoplayTimer = window.setTimeout(() => {
      this.scriptedAutoplayTimer = null;
      const currentState = this.store.getState();
      if (currentState.scriptedAutoplay && currentState.screen === 'active') {
        this.store.advanceDialogueOrEnd();
      }
    }, delayMs);
  }

  private captureAnimatedNodes(root: ParentNode) {
    this.animatedNodes = {
      leftFrame: root.querySelector<HTMLElement>('.codec-portrait-bay-left .portrait-frame'),
      rightFrame: root.querySelector<HTMLElement>('.codec-portrait-bay-right .portrait-frame'),
      leftFace: root.querySelector<HTMLElement>('.codec-portrait-bay-left .portrait-face'),
      rightFace: root.querySelector<HTMLElement>('.codec-portrait-bay-right .portrait-face'),
      signalBars: root.querySelector<HTMLElement>('.signal-bars'),
    };
  }

  private applyAnimatedPortraitFrame(frame: CodecPortraitAnimationFrame) {
    const {
      leftFrame,
      rightFrame,
      leftFace,
      rightFace,
      signalBars,
    } = this.animatedNodes;

    if (leftFrame) {
      leftFrame.classList.toggle('active', frame.left.active);
    }
    if (rightFrame) {
      rightFrame.classList.toggle('active', frame.right.active);
    }

    if (leftFace) {
      leftFace.dataset.portraitState = frame.left.portraitState;
      leftFace.dataset.portraitExpression = frame.left.expression;
      leftFace.dataset.portraitFamily = frame.left.family;
      leftFace.dataset.codecSpriteFrameKey = frame.left.frameKey ?? '';
      leftFace.dataset.codecSpriteFrameRect = formatFrameRect(frame.left.frameRect);
      leftFace.dataset.codecSpriteUsesManifest = frame.left.usesManifestFrame ? 'true' : 'false';
    }
    if (rightFace) {
      rightFace.dataset.portraitState = frame.right.portraitState;
      rightFace.dataset.portraitExpression = frame.right.expression;
      rightFace.dataset.portraitFamily = frame.right.family;
      rightFace.dataset.codecSpriteFrameKey = frame.right.frameKey ?? '';
      rightFace.dataset.codecSpriteFrameRect = formatFrameRect(frame.right.frameRect);
      rightFace.dataset.codecSpriteUsesManifest = frame.right.usesManifestFrame ? 'true' : 'false';
    }

    if (signalBars) {
      signalBars.innerHTML = renderSignalBars(frame.barBucket);
    }

    if (leftFace || rightFace) {
      syncCodecSpritePortraits(document);
    }

    if (
      this.fxDebugEnabled
      && this.lastRenderedState
      && this.lastRenderedScene
      && document.querySelector('#fxDebugReadout')
    ) {
      this.syncFxDebugReadout(
        document,
        this.lastRenderedState,
        this.lastRenderedScene,
        frame,
        this.lastEffectiveGlitch,
      );
    }
  }

  private renderDebugView(state: AppState) {
    const latestUserFinal = [...state.transcript].reverse().find((entry) => entry.role === 'user') ?? null;
    const latestGenerated = [...state.transcript].reverse().find((entry) => entry.role === 'contact' || entry.role === 'system') ?? null;
    const scriptedContactScenarios = getScriptedScenariosForContact(CONTACTS[state.selectedContactIndex]?.characterId);
    const selectedScenarioId = this.scriptedScenarioSelectionByContact.get(state.selectedContactIndex)
      ?? scriptedContactScenarios[0]?.id
      ?? '';

    return `
      <div class="wrap">
        <div class="companion-header">
          <div>
            <p class="eyebrow">Debug Mode</p>
            <h1>What Even</h1>
            <p class="subtitle">Diagnostics, lifecycle harness, logs, and raw state live here.</p>
            ${state.simulatorSessionDetected
              ? '<div class="simulator-session-badge">SIMULATOR SESSION DETECTED — this is not the real glasses.</div>'
              : ''}
            ${state.evenNativeHostDetected
              ? ''
              : '<div class="host-warning-banner">Even native host missing. Glasses startup will be skipped in this browser context.</div>'}
          </div>
          <div class="header-actions">
            <button id="toggleDebugBtn" class="primary-action debug-exit">Exit Debug</button>
            <button
              id="startEvenBtn"
              class="header-button ${state.evenNativeHostDetected ? '' : 'header-button-disabled'}"
              title="${state.evenNativeHostDetected ? 'Start on Even' : 'Requires the Even app native host'}"
            >${state.started ? 'Restart on Even' : 'Start on Even'}</button>
            <button id="copyLogBtn" class="header-button">Copy Log</button>
            <button id="clearLogBtn" class="header-button">Clear Log</button>
          </div>
        </div>

        ${this.renderLifecycleHarnessPanel()}
        <div class="harness-card">
          <div class="harness-header">
            <div>
              <div class="harness-title">Scripted Scenario Playback</div>
              <div class="harness-subtitle">Extends the existing transcript cursor/state pipeline.</div>
            </div>
          </div>
          <div class="harness-actions">
            <select id="scriptScenarioPicker" ${scriptedContactScenarios.length === 0 ? 'disabled' : ''}>
              ${scriptedContactScenarios.map((scenario) => `
                <option value="${scenario.id}" ${scenario.id === selectedScenarioId ? 'selected' : ''}>${scenario.title}</option>
              `).join('')}
            </select>
            <button id="scriptStartBtn" ${scriptedContactScenarios.length === 0 ? 'disabled' : ''}>Start Scripted</button>
            <button id="scriptAdvanceBtn" ${state.scriptedScenarioId ? '' : 'disabled'}>Advance</button>
            <button id="scriptReplayBtn" ${state.scriptedScenarioId ? '' : 'disabled'}>Replay Line</button>
            <button id="scriptStopBtn" ${state.scriptedScenarioId ? '' : 'disabled'}>Stop/Reset</button>
            <button id="scriptAutoplayBtn" ${state.scriptedScenarioId ? '' : 'disabled'}>${state.scriptedAutoplay ? 'Autoplay: On' : 'Autoplay: Off'}</button>
          </div>
        </div>

        <div class="debug-card">
          <div class="debug-section">
            <div class="debug-heading">Session</div>
            <div class="debug-grid">
              <div>Screen: <strong>${state.screen}</strong></div>
              <div>Return Screen: <strong>${state.screenBeforeDebug}</strong></div>
              <div>Lifecycle: <strong>${state.deviceLifecycleState}</strong></div>
              <div>Even Startup: <strong>${state.evenStartupStatus}</strong></div>
              <div>Startup Blocked: <strong>${state.evenStartupBlockedCode ?? 'none'}</strong></div>
              <div>Startup Message: <strong>${state.evenStartupBlockedMessage ?? 'none'}</strong></div>
              <div>Native Host: <strong>${state.evenNativeHostDetected ? 'detected' : 'missing'}</strong></div>
              <div>Simulator Session: <strong>${state.simulatorSessionDetected ? 'detected' : 'not detected'}</strong></div>
              <div>Image Sync: <strong>${state.imageSync.lastResult}</strong></div>
              <div>Last Input: <strong>${state.lastNormalizedInput ?? 'none'}</strong></div>
              <div>Raw Source: <strong>${state.lastRawEvent?.source ?? 'none'}</strong></div>
              <div>Raw Type: <strong>${state.lastRawEvent?.rawEventTypeName ?? 'none'}</strong></div>
            </div>
          </div>
          <div class="debug-section">
            <div class="debug-heading">Listening / STT</div>
            <div class="debug-grid">
              <div>Mic Open: <strong>${state.micOpen ? 'yes' : 'no'}</strong></div>
              <div>Capture: <strong>${state.audioCaptureStatus}</strong></div>
              <div>STT: <strong>${state.sttStatus}</strong></div>
              <div>Listening Session: <strong>${state.listeningSessionId}</strong></div>
              <div>Active STT Session ID: <strong>${state.reliability.activeSttListeningSessionId ?? 'none'}</strong></div>
              <div>Active STT Token: <strong>${state.reliability.activeSttSessionToken ?? 'none'}</strong></div>
              <div>STT Partial: <strong>${state.sttPartialTranscript || 'none'}</strong></div>
              <div>STT Error: <strong>${state.sttError ?? 'none'}</strong></div>
              <div>Last Transcript At: <strong>${state.lastTranscriptAt === null ? 'none' : new Date(state.lastTranscriptAt).toLocaleTimeString()}</strong></div>
            </div>
          </div>
          <div class="debug-section">
            <div class="debug-heading">Reliability</div>
            <div class="debug-grid">
              <div>Retry Attempted Session: <strong>${state.reliability.sttReconnectAttemptedSessionId ?? 'none'}</strong></div>
              <div>Retry Scheduled Session: <strong>${state.reliability.sttRetryScheduledForSessionId ?? 'none'}</strong></div>
              <div>Retry Scheduled At: <strong>${state.reliability.sttRetryScheduledAt === null ? 'none' : new Date(state.reliability.sttRetryScheduledAt).toLocaleTimeString()}</strong></div>
              <div>Retry Cancelled At: <strong>${state.reliability.sttRetryCancelledAt === null ? 'none' : new Date(state.reliability.sttRetryCancelledAt).toLocaleTimeString()}</strong></div>
              <div>Pending Partial Flush: <strong>${state.reliability.pendingPartialFlush ? 'yes' : 'no'}</strong></div>
              <div>Last Ignored Stale Callback: <strong>${state.reliability.lastIgnoredStaleCallback ?? 'none'}</strong></div>
              <div>Ignored Callback At: <strong>${state.reliability.lastIgnoredStaleCallbackAt === null ? 'none' : new Date(state.reliability.lastIgnoredStaleCallbackAt).toLocaleTimeString()}</strong></div>
              <div>Last Cleanup Reason: <strong>${state.reliability.lastCleanupReason ?? 'none'}</strong></div>
              <div>Cleanup At: <strong>${state.reliability.lastCleanupAt === null ? 'none' : new Date(state.reliability.lastCleanupAt).toLocaleTimeString()}</strong></div>
            </div>
          </div>
          <div class="debug-section">
            <div class="debug-heading">Turn / Response</div>
            <div class="debug-grid">
              <div>Turn State: <strong>${state.turnState}</strong></div>
              <div>Pending Response ID: <strong>${state.pendingResponseId ?? 'none'}</strong></div>
              <div>Last Handled User ID: <strong>${state.lastHandledUserTranscriptId ?? 'none'}</strong></div>
              <div>Response Error: <strong>${state.responseError ?? 'none'}</strong></div>
              <div>Response Status At: <strong>${state.responseStatusTimestamp === null ? 'none' : new Date(state.responseStatusTimestamp).toLocaleTimeString()}</strong></div>
              <div>Active Cursor: <strong>${state.activeTranscriptCursor >= 0 ? `${state.activeTranscriptCursor + 1}/${state.transcript.length}` : '0/0'}</strong></div>
              <div>Latest User Final: <strong>${latestUserFinal ? `${latestUserFinal.speaker}: ${latestUserFinal.text}` : 'none'}</strong></div>
              <div>Latest Generated Turn: <strong>${latestGenerated ? `${latestGenerated.speaker}: ${latestGenerated.text}` : 'none'}</strong></div>
            </div>
          </div>
          <div class="debug-section">
            <div class="debug-heading">Audio Metrics</div>
            <div class="debug-grid">
              <div>Buffered Duration: <strong>${state.bufferedAudioDurationMs} ms</strong></div>
              <div>Buffered Bytes: <strong>${state.audioBufferByteLength}</strong></div>
              <div>Buffered Chunks: <strong>${state.audioFrameCount}</strong></div>
              <div>Last Audio At: <strong>${state.lastAudioFrameAt === null ? 'none' : new Date(state.lastAudioFrameAt).toLocaleTimeString()}</strong></div>
              <div>Activity Level: <strong>${Math.round(state.listeningActivityLevel * 100)}%</strong></div>
              <div>Audio Error: <strong>${state.audioError ?? 'none'}</strong></div>
            </div>
          </div>
        </div>

        <div class="debug-section raw-state-card">
          <div class="debug-heading">Raw State</div>
          <pre class="state-dump">${escapeHtml(JSON.stringify(getRawStateSnapshot(state), null, 2))}</pre>
        </div>

        ${renderDebugLog(state.logs)}
      </div>
    `;
  }

  private renderLifecycleHarnessPanel() {
    if (!import.meta.env.DEV) {
      return '';
    }

    const running = this.lifecycleRaceHarness.isRunning();
    const scenarios = this.lifecycleRaceHarness.getScenarioDefinitions();
    const results = this.lifecycleRaceHarness.getResults();

    const buttons = scenarios
      .map((scenario) => `
        <button class="harness-scenario-btn" data-harness-run="${scenario.id}" ${running ? 'disabled' : ''}>
          ${scenario.name}
        </button>
      `)
      .join('');

    const rows = results.length === 0
      ? '<div class="harness-empty">No scenario results yet.</div>'
      : results
        .map((result) => this.renderScenarioResult(result))
        .join('');

    return `
      <div class="harness-card">
        <div class="harness-header">
          <div>
            <div class="harness-title">Lifecycle Race Harness (DEV)</div>
            <div class="harness-subtitle">Each scenario starts from baseline, has timeout bounds, and runs cleanup before the next scenario.</div>
          </div>
          <div class="harness-controls">
            <button id="harnessRunAllBtn" ${running ? 'disabled' : ''}>Run All (Isolated)</button>
            <button id="harnessClearBtn" ${running ? 'disabled' : ''}>Clear Results</button>
          </div>
        </div>
        <div class="harness-actions">${buttons}</div>
        <div class="harness-results">${rows}</div>
      </div>
    `;
  }

  private renderScenarioResult(result: LifecycleRaceScenarioResult) {
    const notes = result.notes.length > 0
      ? result.notes.map((note) => `<div>${note}</div>`).join('')
      : '<div>none</div>';
    return `
      <div class="harness-result-row">
        <div class="harness-result-top">
          <strong>${result.name}</strong>
          <span class="harness-status harness-status-${result.status}">${result.status.toUpperCase()}</span>
        </div>
        <div class="harness-result-grid">
          <div>cleanupRecovered: <strong>${result.cleanupRecovered ? 'true' : 'false'}</strong></div>
          <div>duration: <strong>${result.durationMs}ms</strong> (timeout ${result.timeoutMs}ms)</div>
          <div>startup: <strong>${result.diagnostics.evenStartupStatus}</strong></div>
          <div>startupBlock: <strong>${result.diagnostics.evenStartupBlockedCode ?? 'none'}</strong></div>
          <div>finalScreen: <strong>${result.finalScreen}</strong></div>
          <div>transcriptDelta: <strong>${result.transcriptDelta}</strong></div>
          <div>pendingResponseLeaked: <strong>${result.pendingResponseLeaked ? 'yes' : 'no'}</strong></div>
          <div>retryScheduled: <strong>${result.diagnostics.retryScheduledForSessionId ?? 'none'}</strong></div>
          <div>mic/audio/stt: <strong>${result.diagnostics.micOpen ? 'open' : 'closed'} / ${result.diagnostics.audioCaptureStatus} / ${result.diagnostics.sttStatus}</strong></div>
          <div>ignoredStale: <strong>${result.diagnostics.lastIgnoredStaleCallback ?? 'none'}</strong></div>
          <div>cleanupReason: <strong>${result.diagnostics.lastCleanupReason ?? 'none'}</strong></div>
        </div>
        <div class="harness-notes">${notes}</div>
      </div>
    `;
  }

  private bindControls(state: AppState) {
    const startEvenBtn = document.querySelector<HTMLButtonElement>('#startEvenBtn');
    if (startEvenBtn) {
      startEvenBtn.onclick = () => {
        void this.startOnEven();
      };
    }

    const toggleDebugBtn = document.querySelector<HTMLButtonElement>('#toggleDebugBtn');
    if (toggleDebugBtn) {
      toggleDebugBtn.onclick = () => {
        if (this.store.getState().screen === 'debug') {
          this.store.exitDebugScreen();
        } else {
          this.store.enterDebugScreen();
        }
      };
    }

    const toggleDebugBtnInline = document.querySelector<HTMLButtonElement>('#toggleDebugBtnInline');
    if (toggleDebugBtnInline) {
      toggleDebugBtnInline.onclick = () => {
        if (this.store.getState().screen === 'debug') {
          this.store.exitDebugScreen();
        } else {
          this.store.enterDebugScreen();
        }
      };
    }

    const debugDrawerToggleBtn = document.querySelector<HTMLButtonElement>('#debugDrawerToggleBtn');
    if (debugDrawerToggleBtn) {
      debugDrawerToggleBtn.onclick = () => {
        this.debugDrawerOpen = !this.debugDrawerOpen;
        this.render(this.store.getState());
      };
    }

    const debugDrawerCloseBtn = document.querySelector<HTMLButtonElement>('#debugDrawerCloseBtn');
    if (debugDrawerCloseBtn) {
      debugDrawerCloseBtn.onclick = () => {
        this.debugDrawerOpen = false;
        this.render(this.store.getState());
      };
    }

    const contactPicker = document.querySelector<HTMLSelectElement>('#contactPicker');
    if (contactPicker) {
      contactPicker.onchange = () => {
        this.store.setSelectedContactIndex(Number(contactPicker.value));
        this.contactPickerOpen = false;
        this.render(this.store.getState());
      };
    }

    const contactPickerDismissBtn = document.querySelector<HTMLButtonElement>('#contactPickerDismissBtnSecondary');
    if (contactPickerDismissBtn) {
      contactPickerDismissBtn.onclick = () => {
        this.contactPickerOpen = false;
        this.render(this.store.getState());
      };
    }

    const contactPickerBackdrop = document.querySelector<HTMLDivElement>('#contactPickerDismissBtn');
    if (contactPickerBackdrop) {
      contactPickerBackdrop.onclick = () => {
        this.contactPickerOpen = false;
        this.render(this.store.getState());
      };
    }

    const chooseContactBtn = document.querySelector<HTMLButtonElement>('#chooseContactBtn');
    if (chooseContactBtn) {
      chooseContactBtn.onclick = () => {
        this.contactPickerOpen = !this.contactPickerOpen;
        this.render(this.store.getState());
      };
    }

    const startCallBtn = document.querySelector<HTMLButtonElement>('#startCallBtn');
    if (startCallBtn) {
      startCallBtn.onclick = () => {
        if (this.store.getState().screen === 'contacts') {
          this.store.goToIncomingForSelectedContact();
        }
      };
    }

    const continueBtn = document.querySelector<HTMLButtonElement>('#continueBtn');
    if (continueBtn) {
      continueBtn.onclick = () => {
        if (this.store.getState().screen === 'listening') {
          this.store.setListeningActionIndex(0);
          this.store.transmitCurrentUserTurn();
        }
      };
    }

    const retryBtn = document.querySelector<HTMLButtonElement>('#retryBtn');
    if (retryBtn) {
      retryBtn.onclick = () => {
        const currentState = this.store.getState();
        if (currentState.screen === 'listening') {
          this.store.setListeningActionIndex(1);
          this.store.retryListeningTurn();
        }
      };
    }

    const reviewBtn = document.querySelector<HTMLButtonElement>('#reviewBtn');
    if (reviewBtn) {
      reviewBtn.onclick = () => {
        if (this.store.getState().screen === 'listening') {
          this.store.setListeningActionIndex(2);
          this.store.enterListeningReviewMode();
        }
      };
    }

    const reviewExitBtn = document.querySelector<HTMLButtonElement>('#reviewExitBtn');
    if (reviewExitBtn) {
      reviewExitBtn.onclick = () => {
        if (this.store.getState().screen === 'listening') {
          this.store.exitListeningReviewMode();
        }
      };
    }

    const nextBtn = document.querySelector<HTMLButtonElement>('#nextBtn');
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.store.getState().screen === 'active') {
          this.store.setActiveActionIndex(0);
          this.store.advanceDialogueOrEnd();
        }
      };
    }

    const scriptScenarioPicker = document.querySelector<HTMLSelectElement>('#scriptScenarioPicker');
    if (scriptScenarioPicker) {
      scriptScenarioPicker.onchange = () => {
        this.scriptedScenarioSelectionByContact.set(state.selectedContactIndex, scriptScenarioPicker.value);
      };
    }

    const scriptStartBtn = document.querySelector<HTMLButtonElement>('#scriptStartBtn');
    if (scriptStartBtn) {
      scriptStartBtn.onclick = () => {
        const scenarioId = this.scriptedScenarioSelectionByContact.get(state.selectedContactIndex)
          ?? scriptScenarioPicker?.value
          ?? '';
        if (!scenarioId) {
          return;
        }
        this.store.startScriptedScenario({
          contactIndex: state.selectedContactIndex,
          scenarioId,
        });
      };
    }

    const scriptAdvanceBtn = document.querySelector<HTMLButtonElement>('#scriptAdvanceBtn');
    if (scriptAdvanceBtn) {
      scriptAdvanceBtn.onclick = () => {
        this.store.advanceDialogueOrEnd();
      };
    }

    const scriptReplayBtn = document.querySelector<HTMLButtonElement>('#scriptReplayBtn');
    if (scriptReplayBtn) {
      scriptReplayBtn.onclick = () => {
        this.store.replayCurrentScriptedLine();
      };
    }

    const scriptStopBtn = document.querySelector<HTMLButtonElement>('#scriptStopBtn');
    if (scriptStopBtn) {
      scriptStopBtn.onclick = () => {
        this.store.stopScriptedScenario();
      };
    }

    const scriptAutoplayBtn = document.querySelector<HTMLButtonElement>('#scriptAutoplayBtn');
    if (scriptAutoplayBtn) {
      scriptAutoplayBtn.onclick = () => {
        this.store.setScriptedAutoplay(!this.store.getState().scriptedAutoplay);
      };
    }

    const endBtn = document.querySelector<HTMLButtonElement>('#endBtn');
    if (endBtn) {
      endBtn.onclick = () => {
        const currentState = this.store.getState();
        if (currentState.screen === 'listening') {
          this.store.endListening();
          return;
        }

        if (currentState.screen === 'active') {
          this.store.endCall();
        }
      };
    }

    const redialBtn = document.querySelector<HTMLButtonElement>('#redialBtn');
    if (redialBtn) {
      redialBtn.onclick = () => {
        if (this.store.getState().screen === 'ended') {
          this.store.setEndedActionIndex(1);
          this.store.redialCurrentContact();
        }
      };
    }

    const backBtn = document.querySelector<HTMLButtonElement>('#backBtn');
    if (backBtn) {
      backBtn.onclick = () => {
        if (this.store.getState().screen === 'ended') {
          this.store.setEndedActionIndex(0);
          this.store.backToContacts();
        }
      };
    }

    const copyLogBtn = document.querySelector<HTMLButtonElement>('#copyLogBtn');
    if (copyLogBtn) {
      copyLogBtn.onclick = () => {
        void this.copyLog();
      };
    }

    const clearLogBtn = document.querySelector<HTMLButtonElement>('#clearLogBtn');
    if (clearLogBtn) {
      clearLogBtn.onclick = () => {
        this.store.clearLogs();
      };
    }

    if (this.fxDemoEnabled) {
      const fxModeButtons = document.querySelectorAll<HTMLButtonElement>('[data-fx-demo-mode]');
      for (const button of fxModeButtons) {
        button.onclick = () => {
          this.fxDemoMode = parseFxDemoMode(button.dataset.fxDemoMode);
          this.updateFxQueryState();
          this.render(this.store.getState());
        };
      }

      const fxSideButtons = document.querySelectorAll<HTMLButtonElement>('[data-fx-demo-side]');
      for (const button of fxSideButtons) {
        button.onclick = () => {
          this.fxDemoSide = parseFxDemoSide(button.dataset.fxDemoSide);
          this.updateFxQueryState();
          this.render(this.store.getState());
        };
      }
    }

    const logEl = document.querySelector<HTMLPreElement>('#log');
    if (logEl) {
      logEl.scrollTop = logEl.scrollHeight;
    }

    if (state.logs.length === 0) {
      this.store.log('Web controls bound.');
    }
  }

  private bindLifecycleHarnessControls() {
    if (!import.meta.env.DEV) {
      return;
    }

    const runAllButton = document.querySelector<HTMLButtonElement>('#harnessRunAllBtn');
    if (runAllButton) {
      runAllButton.onclick = () => {
        void this.lifecycleRaceHarness.runAll();
      };
    }

    const clearButton = document.querySelector<HTMLButtonElement>('#harnessClearBtn');
    if (clearButton) {
      clearButton.onclick = () => {
        this.lifecycleRaceHarness.clearResults();
      };
    }

    const scenarioButtons = document.querySelectorAll<HTMLButtonElement>('[data-harness-run]');
    scenarioButtons.forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.harnessRun as LifecycleRaceScenarioId | undefined;
        if (!id) {
          return;
        }

        void this.lifecycleRaceHarness.runScenario(id);
      };
    });
  }

  private async copyLog() {
    const text = this.store.getState().logs.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.store.log('Log copied to clipboard.');
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.store.log('Log copied to clipboard.');
      } catch (error) {
        this.store.log(`Copy failed: ${String(error)}`);
      }
    }
  }
}

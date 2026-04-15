import { CONTACTS, RIGHT_CHARACTER } from '../app/contacts';
import { getCanonicalTurnLabel, shouldShowNoConfirmedSpeech } from '../app/presentation';
import { AppStore } from '../app/state';
import type { AppState } from '../app/types';
import {
  LifecycleRaceHarness,
  type LifecycleRaceScenarioId,
  type LifecycleRaceScenarioResult,
} from './dev/lifecycleRaceHarness';
import { renderDebugLog } from './components/DebugLog';
import { renderCodecPortrait } from './components/CodecPortrait';
import { renderSignalBars } from './components/SignalBars';
import { renderTranscriptPanel } from './components/TranscriptPanel';
import { syncCodecSpritePortraits } from './lib/codecSprites';

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

type UserActionConfig = {
  primary: { id: string; label: string };
  secondary: { id: string; label: string };
};

function getUserActionConfig(state: AppState): UserActionConfig | null {
  if (state.screen === 'contacts') {
    return {
      primary: { id: 'startCallBtn', label: 'Start Call' },
      secondary: { id: 'chooseContactBtn', label: 'Choose Contact' },
    };
  }

  if (state.screen === 'incoming') {
    return {
      primary: { id: 'answerBtn', label: 'Answer' },
      secondary: { id: 'ignoreBtn', label: 'Ignore' },
    };
  }

  if (state.screen === 'listening') {
    if (state.sttPartialTranscript.trim()) {
      return {
        primary: { id: 'continueBtn', label: 'Send' },
        secondary: { id: 'retryBtn', label: 'Retry' },
      };
    }

    return {
      primary: { id: 'continueBtn', label: 'Reply' },
      secondary: { id: 'endBtn', label: 'End' },
    };
  }

  if (state.screen === 'active') {
    return {
      primary: { id: 'nextBtn', label: 'Next' },
      secondary: { id: 'endBtn', label: 'End' },
    };
  }

  if (state.screen === 'ended') {
    return {
      primary: { id: 'redialBtn', label: 'Redial' },
      secondary: { id: 'backBtn', label: 'Back' },
    };
  }

  return null;
}

type CodecDialogueSnapshot = {
  stateLabel: string;
  speakerLabel: string;
  currentLine: string;
  previousLine: string | null;
  leftActive: boolean;
  rightActive: boolean;
  mouthOpen: boolean;
  barLevel: number;
};

function shortenLine(text: string, maxChars = 92) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function getCodecBarLevel(state: AppState) {
  if (state.screen === 'incoming') {
    return 8;
  }

  if (state.screen === 'ended') {
    return 2;
  }

  if (state.screen === 'active') {
    return 7;
  }

  if (state.screen === 'listening') {
    return Math.max(3, Math.min(10, Math.round(state.listeningActivityLevel * 10)));
  }

  return state.started ? 5 : 2;
}

function getPreviousEntryLine(state: AppState, currentIndex: number) {
  if (currentIndex <= 0 || currentIndex >= state.transcript.length) {
    return null;
  }

  const previous = state.transcript[currentIndex - 1];
  return previous ? shortenLine(`${previous.speaker.toUpperCase()}: ${previous.text}`, 76) : null;
}

function getCodecDialogueSnapshot(state: AppState): CodecDialogueSnapshot {
  const contact = CONTACTS[state.selectedContactIndex];
  const partial = state.sttPartialTranscript.trim();
  const latestUser = [...state.transcript].reverse().find((entry) => entry.role === 'user') ?? null;
  const latestContact = [...state.transcript].reverse().find((entry) => entry.role === 'contact' || entry.role === 'system') ?? null;
  const activeEntry = state.activeTranscriptCursor >= 0 ? state.transcript[state.activeTranscriptCursor] ?? null : null;

  if (state.screen === 'incoming') {
    return {
      stateLabel: 'INCOMING CALL',
      speakerLabel: contact.name.toUpperCase(),
      currentLine: 'Secure incoming link request. Answer when ready.',
      previousLine: `FREQUENCY ${contact.frequency}`,
      leftActive: true,
      rightActive: false,
      mouthOpen: false,
      barLevel: getCodecBarLevel(state),
    };
  }

  if (state.screen === 'listening') {
    if (partial) {
      return {
        stateLabel: 'SPEAK',
        speakerLabel: 'YOU',
        currentLine: partial,
        previousLine: latestContact ? shortenLine(`${latestContact.speaker.toUpperCase()}: ${latestContact.text}`, 76) : null,
        leftActive: false,
        rightActive: true,
        mouthOpen: true,
        barLevel: getCodecBarLevel(state),
      };
    }

    if (latestContact) {
      return {
        stateLabel: 'LISTEN',
        speakerLabel: latestContact.speaker.toUpperCase(),
        currentLine: latestContact.text,
        previousLine: latestUser ? shortenLine(`${latestUser.speaker.toUpperCase()}: ${latestUser.text}`, 76) : null,
        leftActive: true,
        rightActive: false,
        mouthOpen: false,
        barLevel: getCodecBarLevel(state),
      };
    }

    return {
      stateLabel: 'YOUR TURN',
      speakerLabel: 'YOU',
      currentLine: shouldShowNoConfirmedSpeech(state)
        ? 'No confirmed speech yet. Speak again when ready.'
        : 'Your line is open. Speak when ready.',
      previousLine: null,
      leftActive: false,
      rightActive: true,
      mouthOpen: state.micOpen,
      barLevel: getCodecBarLevel(state),
    };
  }

  if (state.screen === 'active') {
    const current = activeEntry ?? latestContact ?? latestUser;
    const previousLine = activeEntry
      ? getPreviousEntryLine(state, state.activeTranscriptCursor)
      : latestContact && latestUser
        ? shortenLine(`${latestUser.speaker.toUpperCase()}: ${latestUser.text}`, 76)
        : null;

    return {
      stateLabel: state.responseError ? 'STAND BY' : getCanonicalTurnLabel(state.turnState).toUpperCase(),
      speakerLabel: current?.speaker.toUpperCase() ?? contact.name.toUpperCase(),
      currentLine: current?.text ?? 'Awaiting the next exchange.',
      previousLine,
      leftActive: current?.role === 'contact' || current?.role === 'system',
      rightActive: current?.role === 'user',
      mouthOpen: false,
      barLevel: getCodecBarLevel(state),
    };
  }

  if (state.screen === 'ended') {
    const latestLine = state.transcript.length > 0
      ? state.transcript[state.transcript.length - 1]
      : null;

    return {
      stateLabel: 'CALL ENDED',
      speakerLabel: 'SYSTEM',
      currentLine: 'Codec link closed. Redial or return to directory.',
      previousLine: latestLine ? shortenLine(`${latestLine.speaker.toUpperCase()}: ${latestLine.text}`, 76) : null,
      leftActive: false,
      rightActive: false,
      mouthOpen: false,
      barLevel: getCodecBarLevel(state),
    };
  }

  return {
    stateLabel: state.started ? 'STAND BY' : 'SETUP',
    speakerLabel: 'SYSTEM',
    currentLine: state.started
      ? 'Select a contact and start the codec link.'
      : 'Start on Even to arm the mobile codec companion.',
    previousLine: `${contact.name.toUpperCase()} TUNED ${contact.frequency}`,
    leftActive: false,
    rightActive: false,
    mouthOpen: false,
    barLevel: getCodecBarLevel(state),
  };
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
  private unsubscribe: (() => void) | null = null;
  private readonly lifecycleRaceHarness: LifecycleRaceHarness;
  private contactPickerOpen = false;
  private debugDrawerOpen = false;
  private previousState: AppState | null = null;
  private activeCodecGlitch: 'connect' | 'switch' | 'interrupt' | null = null;
  private codecGlitchTimer: number | null = null;

  constructor(options: {
    store: AppStore;
    startOnEven: (options?: { forceReset?: boolean }) => Promise<void>;
  }) {
    this.store = options.store;
    this.startOnEven = options.startOnEven;
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
  }

  private render(state: AppState) {
    const nextGlitch = this.getCodecGlitchEvent(this.previousState, state);
    if (nextGlitch) {
      this.triggerCodecGlitch(nextGlitch);
    }

    const root = mustQuery<HTMLDivElement>('#webRoot');

    root.innerHTML = state.screen === 'debug'
      ? this.renderDebugView(state)
      : this.renderUserView(state);

    syncCodecSpritePortraits(root);
    this.bindControls(state);
    this.bindLifecycleHarnessControls();
    this.previousState = state;
  }

  private getCodecGlitchEvent(
    previousState: AppState | null,
    state: AppState,
  ): 'connect' | 'switch' | 'interrupt' | null {
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

  private triggerCodecGlitch(kind: 'connect' | 'switch' | 'interrupt') {
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

  private renderUserView(state: AppState) {
    const contact = CONTACTS[state.selectedContactIndex];
    const actions = getUserActionConfig(state);
    const snapshot = getCodecDialogueSnapshot(state);
    const pickerVisible = state.screen === 'contacts' && this.contactPickerOpen;
    const transcriptTitle = state.screen === 'contacts' ? 'Recent Exchange' : 'Conversation Log';
    const latestError = getLatestRuntimeError(state);
    const surfaceMode = state.screen === 'contacts'
      ? 'Directory standby'
      : state.screen === 'incoming'
        ? 'Incoming link'
        : state.screen === 'listening'
          ? 'Live listening'
          : state.screen === 'active'
            ? 'Codec channel open'
            : 'Link closed';
    const leftPortrait = renderCodecPortrait({
      label: contact.name.toUpperCase(),
      tag: contact.portraitTag,
      characterId: contact.characterId,
      active: snapshot.leftActive,
      mouthOpen: snapshot.leftActive && snapshot.mouthOpen,
    });
    const rightPortrait = renderCodecPortrait({
      label: RIGHT_CHARACTER.name.toUpperCase(),
      tag: RIGHT_CHARACTER.portraitTag,
      characterId: RIGHT_CHARACTER.characterId,
      active: snapshot.rightActive,
      mouthOpen: snapshot.rightActive && snapshot.mouthOpen,
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
          <div class="codec-machine ${this.activeCodecGlitch ? `codec-glitch-${this.activeCodecGlitch}` : ''}">
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
                <strong>${escapeHtml(snapshot.stateLabel)}</strong>
                <span>${escapeHtml(snapshot.speakerLabel)}</span>
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
                    <div class="signal-bars">${renderSignalBars(snapshot.barLevel)}</div>
                    <div class="frequency-stack">
                      <span class="signal-label">TUNE</span>
                      <strong>${escapeHtml(contact.frequency)}</strong>
                      <span class="signal-subtitle">${escapeHtml(snapshot.stateLabel)}</span>
                    </div>
                  </div>
                </div>
                <div class="codec-center-cap bottom">${escapeHtml(snapshot.speakerLabel)}</div>
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
                      <span class="dialogue-speaker">${escapeHtml(snapshot.speakerLabel)}</span>
                      <span class="dialogue-frequency">FREQ ${escapeHtml(contact.frequency)}</span>
                    </div>
                  </div>
                  <span class="codec-state-pill">${escapeHtml(snapshot.stateLabel)}</span>
                </div>
                <div class="dialogue-current-line">${escapeHtml(snapshot.currentLine)}</div>
                ${snapshot.previousLine ? `<div class="dialogue-previous-line">${escapeHtml(snapshot.previousLine)}</div>` : ''}
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
                <button id="${actions.secondary.id}" class="secondary-action codec-action-button">${actions.secondary.label}</button>
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
      </div>
    `;
  }

  private renderDebugView(state: AppState) {
    const latestUserFinal = [...state.transcript].reverse().find((entry) => entry.role === 'user') ?? null;
    const latestGenerated = [...state.transcript].reverse().find((entry) => entry.role === 'contact' || entry.role === 'system') ?? null;

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

    const answerBtn = document.querySelector<HTMLButtonElement>('#answerBtn');
    if (answerBtn) {
      answerBtn.onclick = () => {
        if (this.store.getState().screen === 'incoming') {
          this.store.setIncomingActionIndex(0);
          this.store.answerIncomingAndStartListening();
        }
      };
    }

    const ignoreBtn = document.querySelector<HTMLButtonElement>('#ignoreBtn');
    if (ignoreBtn) {
      ignoreBtn.onclick = () => {
        if (this.store.getState().screen === 'incoming') {
          this.store.setIncomingActionIndex(1);
          this.store.ignoreIncoming();
        }
      };
    }

    const continueBtn = document.querySelector<HTMLButtonElement>('#continueBtn');
    if (continueBtn) {
      continueBtn.onclick = () => {
        if (this.store.getState().screen === 'listening') {
          this.store.setListeningActionIndex(0);
          this.store.continueListeningAndStartActiveCall();
        }
      };
    }

    const retryBtn = document.querySelector<HTMLButtonElement>('#retryBtn');
    if (retryBtn) {
      retryBtn.onclick = () => {
        const currentState = this.store.getState();
        if (currentState.screen === 'listening' && currentState.sttPartialTranscript.trim()) {
          this.store.setListeningActionIndex(1);
          this.store.clearSttPartialTranscript();
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

    const endBtn = document.querySelector<HTMLButtonElement>('#endBtn');
    if (endBtn) {
      endBtn.onclick = () => {
        const currentState = this.store.getState();
        if (currentState.screen === 'listening') {
          this.store.setListeningActionIndex(1);
          this.store.endListening();
          return;
        }

        if (currentState.screen === 'active') {
          this.store.setActiveActionIndex(1);
          this.store.endCall();
        }
      };
    }

    const redialBtn = document.querySelector<HTMLButtonElement>('#redialBtn');
    if (redialBtn) {
      redialBtn.onclick = () => {
        if (this.store.getState().screen === 'ended') {
          this.store.setEndedActionIndex(0);
          this.store.redialCurrentContact();
        }
      };
    }

    const backBtn = document.querySelector<HTMLButtonElement>('#backBtn');
    if (backBtn) {
      backBtn.onclick = () => {
        if (this.store.getState().screen === 'ended') {
          this.store.setEndedActionIndex(1);
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

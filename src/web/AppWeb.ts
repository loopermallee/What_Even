import { CONTACTS } from '../app/contacts';
import { getCanonicalTurnLabel, shouldShowNoConfirmedSpeech } from '../app/presentation';
import { AppStore } from '../app/state';
import type { AppState } from '../app/types';
import {
  LifecycleRaceHarness,
  type LifecycleRaceScenarioId,
  type LifecycleRaceScenarioResult,
} from './dev/lifecycleRaceHarness';
import { renderCodecShell } from './components/CodecShell';
import { renderControlsPanel } from './components/ControlsPanel';
import { renderDebugLog } from './components/DebugLog';

function mustQuery<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

function getCompanionSpeakerAndLine(state: AppState) {
  const contact = CONTACTS[state.selectedContactIndex];
  const canonicalLabel = getCanonicalTurnLabel(state.turnState);

  if (state.screen === 'active') {
    const activeEntry = state.activeTranscriptCursor >= 0 ? state.transcript[state.activeTranscriptCursor] : null;
    if (activeEntry) {
      const leftActive = activeEntry.role === 'contact';
      const stateSuffix = state.turnState === 'error' ? 'Response issue' : canonicalLabel;
      return {
        speaker: activeEntry.speaker.toUpperCase(),
        text: `${activeEntry.text} (${stateSuffix})`,
        leftActive,
        rightActive: !leftActive,
      };
    }

    return {
      speaker: 'ACTIVE',
      text: 'Awaiting input. Waiting for confirmed user speech before response generation.',
      leftActive: true,
      rightActive: false,
    };
  }

  if (state.screen === 'incoming') {
    return {
      speaker: contact.name.toUpperCase(),
      text: `${contact.name} requesting secure link on ${contact.frequency}.`,
      leftActive: true,
      rightActive: false,
    };
  }

  if (state.screen === 'listening') {
    const partial = state.sttPartialTranscript.trim();
    const noConfirmedSpeech = shouldShowNoConfirmedSpeech(state);
    const lastCommitted = [...state.transcript].reverse().find((entry) => entry.text.trim().length > 0)?.text ?? 'none yet';
    const listeningLabel = state.sttStatus === 'streaming' || state.micOpen ? 'Listening' : canonicalLabel;
    const status = state.sttError ? 'STT issue' : listeningLabel;
    const partialOrNoSpeech = partial || (noConfirmedSpeech ? 'No confirmed speech' : '...');
    return {
      speaker: 'LISTENING',
      text: `State: ${status} | Partial: ${partialOrNoSpeech} | Last confirmed: ${lastCommitted} | Audio: mic ${state.micOpen ? 'open' : 'closed'} / ${state.audioCaptureStatus}`,
      leftActive: true,
      rightActive: false,
    };
  }

  if (state.screen === 'ended') {
    return {
      speaker: 'SYSTEM',
      text: 'Connection ended. Use Redial or Back on G2.',
      leftActive: false,
      rightActive: false,
    };
  }

  if (state.screen === 'debug') {
    return {
      speaker: 'DEBUG',
      text: `screen=${state.screenBeforeDebug}, input=${state.lastNormalizedInput ?? 'none'}, lifecycle=${state.deviceLifecycleState}`,
      leftActive: false,
      rightActive: false,
    };
  }

  return {
    speaker: 'STANDBY',
    text: 'Select a contact to open an incoming codec request.',
    leftActive: false,
    rightActive: false,
  };
}

export class AppWeb {
  private readonly store: AppStore;
  private readonly startOnEven: (options?: { forceReset?: boolean }) => Promise<void>;
  private unsubscribe: (() => void) | null = null;
  private speakingTimer: number | null = null;
  private mouthOpen = false;
  private barLevel = 0;
  private readonly lifecycleRaceHarness: LifecycleRaceHarness;

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
      this.render(state);
      this.refreshSpeakingAnimation(state);
    });

    this.render(this.store.getState());
    this.refreshSpeakingAnimation(this.store.getState());
    this.store.log('Web companion ready.');
  }

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.speakingTimer !== null) {
      window.clearInterval(this.speakingTimer);
      this.speakingTimer = null;
    }
  }

  private render(state: AppState) {
    const root = mustQuery<HTMLDivElement>('#webRoot');
    const contact = CONTACTS[state.selectedContactIndex];
    const line = getCompanionSpeakerAndLine(state);

    const latestUserFinal = [...state.transcript].reverse().find((entry) => entry.role === 'user') ?? null;
    const latestGenerated = [...state.transcript].reverse().find((entry) => entry.role === 'contact' || entry.role === 'system') ?? null;

    root.innerHTML = `
      <div class="wrap">
        <h1>What Even</h1>
        <p class="subtitle">G2-first codec app with companion web UI</p>

        ${renderControlsPanel(state, import.meta.env.DEV)}

        ${this.renderLifecycleHarnessPanel()}

        <div id="codecMount">
          ${renderCodecShell(state, {
      leftLabel: contact.name.toUpperCase(),
      leftTag: contact.portraitTag,
      leftActive: line.leftActive,
      rightActive: line.rightActive,
      mouthOpen: this.mouthOpen,
      frequency: contact.frequency,
      speakerLabel: line.speaker,
      dialogueText: line.text,
      barLevel: this.barLevel,
    })}
        </div>

        <div class="debug-card">
          <div class="debug-section">
            <div class="debug-heading">Session</div>
            <div class="debug-grid">
              <div>Screen: <strong>${state.screen}</strong></div>
              <div>Lifecycle: <strong>${state.deviceLifecycleState}</strong></div>
              <div>Even Startup: <strong>${state.evenStartupStatus}</strong></div>
              <div>Startup Blocked: <strong>${state.evenStartupBlockedCode ?? 'none'}</strong></div>
              <div>Image Sync: <strong>${state.imageSync.lastResult}</strong></div>
              <div>Last Input: <strong>${state.lastNormalizedInput ?? 'none'}</strong></div>
              <div>Raw Source: <strong>${state.lastRawEvent?.source ?? 'none'}</strong></div>
              <div>Raw Type: <strong>${state.lastRawEvent?.rawEventTypeName ?? 'none'}</strong></div>
              <div>Startup Message: <strong>${state.evenStartupBlockedMessage ?? 'none'}</strong></div>
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

        ${renderDebugLog(state.logs)}
      </div>
    `;

    this.bindControls(state);
    this.bindLifecycleHarnessControls();
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
    mustQuery<HTMLButtonElement>('#startEvenBtn').onclick = () => {
      void this.startOnEven();
    };

    mustQuery<HTMLButtonElement>('#prevContactBtn').onclick = () => {
      if (this.store.getState().screen === 'contacts') {
        this.store.moveContactSelection(-1);
      }
    };

    mustQuery<HTMLButtonElement>('#nextContactBtn').onclick = () => {
      if (this.store.getState().screen === 'contacts') {
        this.store.moveContactSelection(1);
      }
    };

    mustQuery<HTMLButtonElement>('#openIncomingBtn').onclick = () => {
      if (this.store.getState().screen === 'contacts') {
        this.store.goToIncomingForSelectedContact();
      }
    };

    mustQuery<HTMLButtonElement>('#listeningContinueBtn').onclick = () => {
      if (this.store.getState().screen === 'listening') {
        this.store.setListeningActionIndex(0);
        this.store.continueListeningAndStartActiveCall();
      }
    };

    mustQuery<HTMLButtonElement>('#listeningEndBtn').onclick = () => {
      if (this.store.getState().screen === 'listening') {
        this.store.setListeningActionIndex(1);
        this.store.endListening();
      }
    };

    mustQuery<HTMLButtonElement>('#activeNextBtn').onclick = () => {
      if (this.store.getState().screen === 'active') {
        this.store.setActiveActionIndex(0);
        this.store.advanceDialogueOrEnd();
      }
    };

    mustQuery<HTMLButtonElement>('#activeEndBtn').onclick = () => {
      if (this.store.getState().screen === 'active') {
        this.store.setActiveActionIndex(1);
        this.store.endCall();
      }
    };

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

    mustQuery<HTMLButtonElement>('#copyLogBtn').onclick = () => {
      void this.copyLog();
    };

    mustQuery<HTMLButtonElement>('#clearLogBtn').onclick = () => {
      this.store.clearLogs();
    };

    const logEl = mustQuery<HTMLPreElement>('#log');
    logEl.scrollTop = logEl.scrollHeight;

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

  private refreshSpeakingAnimation(state: AppState) {
    if (state.screen === 'listening') {
      if (this.speakingTimer !== null) {
        window.clearInterval(this.speakingTimer);
        this.speakingTimer = null;
      }

      this.mouthOpen = false;
      this.barLevel = Math.max(0, Math.min(10, Math.round(state.listeningActivityLevel * 10)));
      return;
    }

    const active = state.screen === 'active' && state.activeTranscriptCursor >= 0;

    if (!active) {
      if (this.speakingTimer !== null) {
        window.clearInterval(this.speakingTimer);
        this.speakingTimer = null;
      }

      this.mouthOpen = false;
      this.barLevel = 0;
      return;
    }

    const activeEntry = state.transcript[state.activeTranscriptCursor];
    if (!activeEntry) {
      return;
    }

    if (this.speakingTimer !== null) {
      return;
    }

    const levels = [2, 4, 7, 5, 8, 3, 6];
    this.speakingTimer = window.setInterval(() => {
      this.mouthOpen = activeEntry.role !== 'system' ? !this.mouthOpen : false;
      this.barLevel = levels[Math.floor(Math.random() * levels.length)] ?? 0;
      this.render(this.store.getState());
    }, 140);
  }
}

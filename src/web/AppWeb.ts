import { CONTACTS } from '../app/contacts';
import { AppStore } from '../app/state';
import type { AppState } from '../app/types';
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

  if (state.screen === 'active' && state.dialogueIndex >= 0) {
    const line = contact.dialogue[state.dialogueIndex];
    if (line) {
      return {
        speaker: (line.speaker === 'left' ? contact.name : 'Snake').toUpperCase(),
        text: line.text,
        leftActive: line.speaker === 'left',
        rightActive: line.speaker === 'right',
      };
    }
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
    const lastCommitted = [...state.transcript].reverse().find((entry) => entry.text.trim().length > 0)?.text ?? 'none yet';
    const status = state.sttError ? `${state.sttStatus} (error)` : state.sttStatus;
    return {
      speaker: 'LISTENING',
      text: `STT ${status} | Partial: ${partial || '...'} | Last: ${lastCommitted} | Audio: mic ${state.micOpen ? 'open' : 'closed'} / ${state.audioCaptureStatus}`,
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

  constructor(options: {
    store: AppStore;
    startOnEven: (options?: { forceReset?: boolean }) => Promise<void>;
  }) {
    this.store = options.store;
    this.startOnEven = options.startOnEven;
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

    root.innerHTML = `
      <div class="wrap">
        <h1>What Even</h1>
        <p class="subtitle">G2-first codec app with companion web UI</p>

        ${renderControlsPanel(state, import.meta.env.DEV)}

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
          <div>Current Screen: <strong>${state.screen}</strong></div>
          <div>Last Input: <strong>${state.lastNormalizedInput ?? 'none'}</strong></div>
          <div>Last Raw Source: <strong>${state.lastRawEvent?.source ?? 'none'}</strong></div>
          <div>Last Raw Type: <strong>${state.lastRawEvent?.rawEventTypeName ?? 'none'}</strong></div>
          <div>Lifecycle: <strong>${state.deviceLifecycleState}</strong></div>
          <div>Image Sync: <strong>${state.imageSync.lastResult}</strong></div>
          <div>Mic Open: <strong>${state.micOpen ? 'yes' : 'no'}</strong></div>
          <div>Capture Status: <strong>${state.audioCaptureStatus}</strong></div>
          <div>STT Status: <strong>${state.sttStatus}</strong></div>
          <div>STT Partial: <strong>${state.sttPartialTranscript || 'none'}</strong></div>
          <div>Last Transcript At: <strong>${state.lastTranscriptAt === null ? 'none' : new Date(state.lastTranscriptAt).toLocaleTimeString()}</strong></div>
          <div>STT Error: <strong>${state.sttError ?? 'none'}</strong></div>
          <div>Buffered Duration: <strong>${state.bufferedAudioDurationMs} ms</strong></div>
          <div>Buffered Bytes: <strong>${state.audioBufferByteLength}</strong></div>
          <div>Buffered Chunks: <strong>${state.audioFrameCount}</strong></div>
          <div>Last Audio At: <strong>${state.lastAudioFrameAt === null ? 'none' : new Date(state.lastAudioFrameAt).toLocaleTimeString()}</strong></div>
          <div>Activity Level: <strong>${Math.round(state.listeningActivityLevel * 100)}%</strong></div>
          <div>Audio Error: <strong>${state.audioError ?? 'none'}</strong></div>
        </div>

        ${renderDebugLog(state.logs)}
      </div>
    `;

    this.bindControls(state);
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

    const active = state.screen === 'active' && state.dialogueIndex >= 0;

    if (!active) {
      if (this.speakingTimer !== null) {
        window.clearInterval(this.speakingTimer);
        this.speakingTimer = null;
      }

      this.mouthOpen = false;
      this.barLevel = 0;
      return;
    }

    if (this.speakingTimer !== null) {
      return;
    }

    const levels = [2, 4, 7, 5, 8, 3, 6];
    this.speakingTimer = window.setInterval(() => {
      this.mouthOpen = !this.mouthOpen;
      this.barLevel = levels[Math.floor(Math.random() * levels.length)] ?? 0;
      this.render(this.store.getState());
    }, 140);
  }
}

import type { AppStore } from '../../app/state';
import type { AppState } from '../../app/types';

export type LifecycleHarnessStatus = 'pass' | 'fail' | 'timeout' | 'blocked';

export type LifecycleRaceScenarioId =
  | 'answer-end-redial-answer'
  | 'answer-continue-active-back'
  | 'repeated-continue'
  | 'repeated-end'
  | 'contact-change-boundary'
  | 'stale-audio-after-exit'
  | 'stale-stt-after-exit'
  | 'retry-cancel-on-exit'
  | 'cleanup-while-listening-or-retry';

export type LifecycleRaceScenarioResult = {
  id: LifecycleRaceScenarioId;
  name: string;
  status: LifecycleHarnessStatus;
  cleanupRecovered: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  timeoutMs: number;
  finalScreen: AppState['screen'];
  transcriptDelta: number;
  pendingResponseLeaked: boolean;
  diagnostics: {
    micOpen: boolean;
    audioCaptureStatus: AppState['audioCaptureStatus'];
    sttStatus: AppState['sttStatus'];
    listeningSessionId: number;
    activeSttListeningSessionId: number | null;
    activeSttSessionToken: number | null;
    retryScheduledForSessionId: number | null;
    lastIgnoredStaleCallback: string | null;
    lastCleanupReason: string | null;
  };
  notes: string[];
};

type ScenarioCheckResult = {
  ok: boolean;
  notes: string[];
};

type ScenarioContext = {
  store: AppStore;
  wait: (ms: number) => Promise<void>;
};

type ScenarioDefinition = {
  id: LifecycleRaceScenarioId;
  name: string;
  timeoutMs?: number;
  run: (ctx: ScenarioContext) => Promise<void>;
  check: (baseline: AppState, finalState: AppState) => ScenarioCheckResult;
};

const DEFAULT_TIMEOUT_MS = 2200;
const SETTLE_WAIT_MS = 70;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRecoveryState(state: AppState) {
  const noLiveSession = state.reliability.activeSttListeningSessionId === null
    && state.reliability.activeSttSessionToken === null;
  const noRetryScheduled = state.reliability.sttRetryScheduledForSessionId === null;
  const noPendingTurnWork = state.pendingResponseId === null;
  const micClosed = !state.micOpen;
  const captureIdle = state.audioCaptureStatus === 'idle' || state.audioCaptureStatus === 'error';
  const sttNotLive = state.sttStatus === 'idle' || state.sttStatus === 'error';

  return state.screen === 'contacts'
    && noLiveSession
    && noRetryScheduled
    && noPendingTurnWork
    && micClosed
    && captureIdle
    && sttNotLive;
}

function makeDiagnostics(state: AppState) {
  return {
    micOpen: state.micOpen,
    audioCaptureStatus: state.audioCaptureStatus,
    sttStatus: state.sttStatus,
    listeningSessionId: state.listeningSessionId,
    activeSttListeningSessionId: state.reliability.activeSttListeningSessionId,
    activeSttSessionToken: state.reliability.activeSttSessionToken,
    retryScheduledForSessionId: state.reliability.sttRetryScheduledForSessionId,
    lastIgnoredStaleCallback: state.reliability.lastIgnoredStaleCallback,
    lastCleanupReason: state.reliability.lastCleanupReason,
  };
}

function quickStateSummary(state: AppState) {
  return `screen=${state.screen}, mic=${state.micOpen ? 'open' : 'closed'}, audio=${state.audioCaptureStatus}, stt=${state.sttStatus}`;
}

function defineScenarios(): ScenarioDefinition[] {
  return [
    {
      id: 'answer-end-redial-answer',
      name: 'Answer -> listening -> End -> Redial -> Answer (rapid)',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(35);
        store.endListening();
        await wait(35);
        store.redialCurrentContact();
        await wait(35);
        store.answerIncomingAndStartListening();
        await wait(80);
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        if (finalState.screen !== 'listening') {
          notes.push(`Expected final screen listening, got ${finalState.screen}.`);
        }
        return { ok: finalState.screen === 'listening', notes };
      },
    },
    {
      id: 'answer-continue-active-back',
      name: 'Answer -> listening -> Continue -> active -> Back (rapid)',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(35);
        store.continueListeningAndStartActiveCall();
        await wait(35);
        store.endCall();
        await wait(35);
        store.backToContacts();
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        if (finalState.screen !== 'contacts') {
          notes.push(`Expected contacts after active back-path emulation, got ${finalState.screen}.`);
        }
        return { ok: finalState.screen === 'contacts', notes };
      },
    },
    {
      id: 'repeated-continue',
      name: 'Repeated Continue taps',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(30);
        for (let i = 0; i < 5; i += 1) {
          store.continueListeningAndStartActiveCall();
          await wait(12);
        }
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        if (finalState.screen !== 'active') {
          notes.push(`Expected active after repeated continue taps, got ${finalState.screen}.`);
        }
        return { ok: finalState.screen === 'active', notes };
      },
    },
    {
      id: 'repeated-end',
      name: 'Repeated End taps',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(25);
        for (let i = 0; i < 5; i += 1) {
          store.endListening();
          await wait(10);
        }
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        if (finalState.screen !== 'ended') {
          notes.push(`Expected ended after repeated End taps, got ${finalState.screen}.`);
        }
        return { ok: finalState.screen === 'ended', notes };
      },
    },
    {
      id: 'contact-change-boundary',
      name: 'Contact change around listening/active boundary',
      run: async ({ store, wait }) => {
        store.setSelectedContactIndex(0);
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(25);
        store.setSelectedContactIndex(1);
        await wait(15);
        store.continueListeningAndStartActiveCall();
        await wait(20);
        store.setSelectedContactIndex(2);
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        const screenOk = finalState.screen === 'active';
        const pendingOk = finalState.pendingResponseId === null;
        if (!screenOk) {
          notes.push(`Expected active after boundary changes, got ${finalState.screen}.`);
        }
        if (!pendingOk) {
          notes.push('Pending response work remained unexpectedly.');
        }
        return { ok: screenOk && pendingOk, notes };
      },
    },
    {
      id: 'stale-audio-after-exit',
      name: 'Stale audio callbacks after listening exit',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(40);
        store.endListening();
        await wait(320);
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        const stillClosed = !finalState.micOpen && finalState.audioCaptureStatus !== 'listening';
        const notStreaming = finalState.sttStatus !== 'streaming';
        if (!stillClosed) {
          notes.push(`Mic/capture revived after listening exit (${quickStateSummary(finalState)}).`);
        }
        if (!notStreaming) {
          notes.push('STT unexpectedly remained streaming after exit.');
        }
        return { ok: stillClosed && notStreaming, notes };
      },
    },
    {
      id: 'stale-stt-after-exit',
      name: 'Stale STT callbacks after listening exit',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(40);
        store.endListening();
        await wait(380);
      },
      check: (baseline, finalState) => {
        const notes: string[] = [];
        const transcriptStable = finalState.transcript.length === baseline.transcript.length;
        const pendingStable = finalState.pendingResponseId === null;
        if (!transcriptStable) {
          notes.push('Transcript mutated after listening exit (possible stale callback effect).');
        }
        if (!pendingStable) {
          notes.push('Pending response survived after listening exit.');
        }
        if (finalState.reliability.lastIgnoredStaleCallback) {
          notes.push(`Observed ignored stale callback: ${finalState.reliability.lastIgnoredStaleCallback}`);
        }
        return { ok: transcriptStable && pendingStable, notes };
      },
    },
    {
      id: 'retry-cancel-on-exit',
      name: 'Retry timer cancellation on exit',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(45);
        store.endListening();
        store.backToContacts();
        await wait(500);
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        const noRetry = finalState.reliability.sttRetryScheduledForSessionId === null;
        if (!noRetry) {
          notes.push(`Retry timer remained scheduled for session ${finalState.reliability.sttRetryScheduledForSessionId}.`);
        }
        return { ok: noRetry, notes };
      },
    },
    {
      id: 'cleanup-while-listening-or-retry',
      name: 'Cleanup while listening or retry pending',
      run: async ({ store, wait }) => {
        store.goToIncomingForSelectedContact();
        store.answerIncomingAndStartListening();
        await wait(45);
        store.backToContacts();
        await wait(180);
      },
      check: (_baseline, finalState) => {
        const notes: string[] = [];
        const contacts = finalState.screen === 'contacts';
        const noPending = finalState.pendingResponseId === null;
        const cleanupTagged = finalState.reliability.lastCleanupAt !== null;
        if (!contacts) {
          notes.push(`Expected contacts after forced cleanup boundary, got ${finalState.screen}.`);
        }
        if (!noPending) {
          notes.push('Pending response work remained after cleanup boundary.');
        }
        if (!cleanupTagged) {
          notes.push('Cleanup timestamp did not update.');
        }
        return { ok: contacts && noPending && cleanupTagged, notes };
      },
    },
  ];
}

export class LifecycleRaceHarness {
  private readonly store: AppStore;
  private readonly scenarios: ScenarioDefinition[];
  private readonly onUpdate: () => void;
  private runNonce = 0;
  private running = false;
  private results: LifecycleRaceScenarioResult[] = [];

  constructor(options: { store: AppStore; onUpdate: () => void }) {
    this.store = options.store;
    this.onUpdate = options.onUpdate;
    this.scenarios = defineScenarios();
  }

  getScenarioDefinitions() {
    return this.scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      timeoutMs: scenario.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }));
  }

  getResults() {
    return this.results;
  }

  isRunning() {
    return this.running;
  }

  clearResults() {
    if (this.running) {
      return;
    }

    this.results = [];
    this.onUpdate();
  }

  async runScenario(id: LifecycleRaceScenarioId) {
    if (this.running) {
      return;
    }

    const scenario = this.scenarios.find((item) => item.id === id);
    if (!scenario) {
      return;
    }

    this.running = true;
    this.runNonce += 1;
    const nonce = this.runNonce;
    this.onUpdate();

    try {
      const result = await this.runSingleScenario(scenario, nonce);
      this.results = [...this.results, result];
    } finally {
      this.running = false;
      this.onUpdate();
    }
  }

  async runAll() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.runNonce += 1;
    const nonce = this.runNonce;
    this.results = [];
    this.onUpdate();

    try {
      for (const scenario of this.scenarios) {
        if (nonce !== this.runNonce) {
          break;
        }

        const result = await this.runSingleScenario(scenario, nonce);
        this.results = [...this.results, result];
        this.onUpdate();
      }
    } finally {
      this.running = false;
      this.onUpdate();
    }
  }

  private async runSingleScenario(definition: ScenarioDefinition, nonce: number): Promise<LifecycleRaceScenarioResult> {
    const startedAt = Date.now();
    const timeoutMs = definition.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const baselineOk = await this.resetToBaseline();
    if (!baselineOk) {
      const now = Date.now();
      const state = this.store.getState();
      return {
        id: definition.id,
        name: definition.name,
        status: 'blocked',
        cleanupRecovered: false,
        startedAt,
        finishedAt: now,
        durationMs: now - startedAt,
        timeoutMs,
        finalScreen: state.screen,
        transcriptDelta: 0,
        pendingResponseLeaked: state.pendingResponseId !== null,
        diagnostics: makeDiagnostics(state),
        notes: ['Baseline reset invariants failed before scenario start.'],
      };
    }

    const baselineState = this.store.getState();
    let runError: string | null = null;
    let timedOut = false;

    try {
      const scenarioPromise = definition.run({
        store: this.store,
        wait: (ms: number) => delay(ms),
      });
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        window.setTimeout(() => resolve('timeout'), timeoutMs);
      });

      const outcome = await Promise.race([
        scenarioPromise.then(() => 'ok' as const),
        timeoutPromise,
      ]);

      if (outcome === 'timeout') {
        timedOut = true;
      }
    } catch (error) {
      runError = String(error);
    }

    await delay(SETTLE_WAIT_MS);
    const cleanupRecovered = await this.cleanupAfterScenario(timedOut ? 'timeout' : 'scenario-complete');
    const finalState = this.store.getState();
    const check = definition.check(baselineState, finalState);
    const notes = [...check.notes];

    if (runError) {
      notes.push(`Scenario threw error: ${runError}`);
    }

    if (!cleanupRecovered) {
      notes.push('Post-scenario cleanup invariants did not recover.');
    }

    let status: LifecycleHarnessStatus;
    if (timedOut) {
      status = cleanupRecovered ? 'timeout' : 'blocked';
      notes.push(`Scenario timed out at ${timeoutMs}ms.`);
    } else {
      status = check.ok && !runError && cleanupRecovered ? 'pass' : 'fail';
    }

    const finishedAt = Date.now();
    if (nonce !== this.runNonce) {
      notes.push('Harness run was superseded by a newer run request.');
    }

    return {
      id: definition.id,
      name: definition.name,
      status,
      cleanupRecovered,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      timeoutMs,
      finalScreen: finalState.screen,
      transcriptDelta: finalState.transcript.length - baselineState.transcript.length,
      pendingResponseLeaked: finalState.pendingResponseId !== null,
      diagnostics: makeDiagnostics(finalState),
      notes,
    };
  }

  private async resetToBaseline() {
    this.store.backToContacts();
    this.store.setSelectedContactIndex(0);
    this.store.setAudioCaptureStatus('idle', { micOpen: false, error: null });
    this.store.setSttStatus('idle', { error: null });
    this.store.clearSttPartialTranscript();
    this.store.setReliabilityDebug({
      activeSttListeningSessionId: null,
      activeSttSessionToken: null,
      sttRetryScheduledForSessionId: null,
      sttRetryScheduledAt: null,
      pendingPartialFlush: false,
    });

    await delay(SETTLE_WAIT_MS);

    return isRecoveryState(this.store.getState());
  }

  private async cleanupAfterScenario(reason: string) {
    this.store.log(`[harness] cleanup start (${reason})`);
    this.store.backToContacts();
    this.store.setAudioCaptureStatus('idle', { micOpen: false, error: null });
    this.store.setSttStatus('idle', { error: null });
    this.store.clearSttPartialTranscript();

    for (let i = 0; i < 4; i += 1) {
      await delay(SETTLE_WAIT_MS);
      if (isRecoveryState(this.store.getState())) {
        this.store.log('[harness] cleanup recovered baseline.');
        return true;
      }
    }

    this.store.log('[harness] cleanup failed to recover baseline invariants.');
    return false;
  }
}

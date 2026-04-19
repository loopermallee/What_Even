import { getCurrentContact } from '../contacts';
import { createAppError, isAppError, toErrorMessage } from '../errors';
import type { AppStore } from '../state';
import type { AppState } from '../types';
import { DeterministicResponseProvider } from './providers/deterministic';
import { GeminiResponseProvider } from './providers/gemini';
import type { ResponseGenerationRequest, ResponseProvider, ResponseProviderTurn } from './providers/base';

type ProviderAttemptOutcome =
  | { status: 'finalized' }
  | { status: 'aborted' }
  | { status: 'timed_out_before_visible'; error: unknown }
  | { status: 'failed_before_visible'; error: unknown }
  | { status: 'failed_after_visible'; error: unknown };

type ProviderAttempt = {
  key: symbol;
  name: string;
  controller: AbortController;
  hasVisibleContent: boolean;
  didFinalize: boolean;
  timedOutBeforeVisible: boolean;
  bufferedPartial: ResponseProviderTurn | null;
  lastAppliedPartialText: string;
  partialTimer: number | null;
  firstVisibleTimer: number | null;
};

type ActiveResponseJob = {
  jobId: number;
  controller: AbortController;
  currentAttempt: ProviderAttempt | null;
  winnerProviderName: string | null;
};

export type ResponseProviderCandidate = {
  name: string;
  provider: ResponseProvider;
  firstVisibleTimeoutMs?: number | null;
};

type ResponseOrchestratorOptions = {
  providers?: ResponseProviderCandidate[];
};

function asProviderTimeoutError(providerName: string, timeoutMs: number) {
  return createAppError({
    category: 'network_error',
    code: `${providerName}_first_visible_timeout`,
    userMessage: `${providerName} did not produce a visible reply within ${timeoutMs}ms.`,
  });
}

function normalizeFirstVisibleTimeoutMs(value: number | null | undefined) {
  if (value == null) {
    return null;
  }

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
}

export class ResponseOrchestrator {
  private readonly store: AppStore;
  private readonly providers: ResponseProviderCandidate[];
  private activeJob: ActiveResponseJob | null = null;
  private readonly unsubscribe: (() => void);
  private readonly partialThrottleMs = 140;

  constructor(store: AppStore, options?: ResponseOrchestratorOptions) {
    this.store = store;
    this.providers = options?.providers?.length
      ? options.providers.map((candidate) => ({
        name: candidate.name,
        provider: candidate.provider,
        firstVisibleTimeoutMs: normalizeFirstVisibleTimeoutMs(candidate.firstVisibleTimeoutMs),
      }))
      : [
        {
          name: 'gemini',
          provider: new GeminiResponseProvider(),
          firstVisibleTimeoutMs: null,
        },
        {
          name: 'deterministic',
          provider: new DeterministicResponseProvider(),
          firstVisibleTimeoutMs: null,
        },
      ];
    this.unsubscribe = this.store.subscribe((state) => {
      this.syncToState(state);
    });
    this.syncToState(this.store.getState());
  }

  cleanup() {
    this.unsubscribe();
    this.cancelActiveJob('cleanup');
  }

  private syncToState(state: AppState) {
    const request = this.getPendingRequest(state);
    if (!request) {
      this.cancelActiveJob('state-cleared');
      return;
    }

    if (this.activeJob?.jobId === request.jobId) {
      return;
    }

    this.cancelActiveJob('job-replaced');
    this.startJob(request);
  }

  private getPendingRequest(state: AppState): ResponseGenerationRequest | null {
    if (state.screen !== 'active' || state.pendingResponseId === null) {
      return null;
    }

    const userTurn = this.findPendingUserTurn(state);
    if (!userTurn) {
      return null;
    }

    const contact = getCurrentContact(state);
    if (!contact) {
      return null;
    }

    return {
      jobId: state.pendingResponseId,
      contact,
      userTurn,
      transcript: state.transcript,
    };
  }

  private findPendingUserTurn(state: AppState) {
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

    return null;
  }

  private startJob(request: ResponseGenerationRequest) {
    const activeJob: ActiveResponseJob = {
      jobId: request.jobId,
      controller: new AbortController(),
      currentAttempt: null,
      winnerProviderName: null,
    };

    this.activeJob = activeJob;
    void this.runJob(request, activeJob);
  }

  private async runJob(request: ResponseGenerationRequest, activeJob: ActiveResponseJob) {
    let lastFailure: unknown = null;

    try {
      for (let index = 0; index < this.providers.length; index += 1) {
        const candidate = this.providers[index];
        if (!this.isActiveJob(activeJob, request.jobId) || activeJob.controller.signal.aborted) {
          return;
        }

        this.store.setResponseStatusPhase('sending', {
          responseJobId: request.jobId,
          turnState: 'processing_user',
        });

        const outcome = await this.runProviderAttempt(candidate, request, activeJob);
        if (outcome.status === 'finalized' || outcome.status === 'aborted') {
          return;
        }

        if (outcome.status === 'failed_after_visible') {
          this.store.failPendingResponse(request.jobId, this.formatProviderError(outcome.error));
          return;
        }

        lastFailure = outcome.error;
        const nextCandidate = this.providers[index + 1];
        if (!nextCandidate) {
          break;
        }

        if (outcome.status === 'timed_out_before_visible') {
          this.store.log(
            `${candidate.name} exceeded the first-visible budget before replying. Falling back to ${nextCandidate.name}.`,
          );
          continue;
        }

        this.store.log(`${candidate.name} failed before visible reply. Falling back to ${nextCandidate.name}.`);
      }

      this.store.failPendingResponse(request.jobId, this.formatProviderError(lastFailure));
    } finally {
      if (this.activeJob === activeJob) {
        this.cancelAttempt(activeJob.currentAttempt);
        this.activeJob = null;
      }
    }
  }

  private async runProviderAttempt(
    candidate: ResponseProviderCandidate,
    request: ResponseGenerationRequest,
    activeJob: ActiveResponseJob,
  ): Promise<ProviderAttemptOutcome> {
    const attempt: ProviderAttempt = {
      key: Symbol(`${candidate.name}-attempt`),
      name: candidate.name,
      controller: new AbortController(),
      hasVisibleContent: false,
      didFinalize: false,
      timedOutBeforeVisible: false,
      bufferedPartial: null,
      lastAppliedPartialText: '',
      partialTimer: null,
      firstVisibleTimer: null,
    };

    activeJob.currentAttempt = attempt;
    if (activeJob.controller.signal.aborted) {
      attempt.controller.abort();
    } else {
      const abortAttempt = () => {
        attempt.controller.abort();
      };
      activeJob.controller.signal.addEventListener('abort', abortAttempt, { once: true });
    }

    const timeoutMs = normalizeFirstVisibleTimeoutMs(candidate.firstVisibleTimeoutMs);
    if (timeoutMs !== null) {
      attempt.firstVisibleTimer = window.setTimeout(() => {
        if (!this.isCurrentAttempt(activeJob, attempt) || attempt.hasVisibleContent || attempt.didFinalize) {
          return;
        }

        attempt.timedOutBeforeVisible = true;
        attempt.controller.abort();
      }, timeoutMs);
    }

    const outcome = await this.executeProvider(candidate, request, activeJob, attempt, timeoutMs);
    if (this.isCurrentAttempt(activeJob, attempt)) {
      activeJob.currentAttempt = null;
    }
    this.clearAttemptState(attempt);
    return outcome;
  }

  private async executeProvider(
    candidate: ResponseProviderCandidate,
    request: ResponseGenerationRequest,
    activeJob: ActiveResponseJob,
    attempt: ProviderAttempt,
    timeoutMs: number | null,
  ): Promise<ProviderAttemptOutcome> {
    let providerFailure: unknown = null;

    try {
      await candidate.provider.generate(
        request,
        {
          onPartial: (turn) => {
            this.handlePartial(activeJob, attempt, turn);
          },
          onFinal: ({ turns }) => {
            if (!this.claimVisibleProvider(activeJob, attempt)) {
              return;
            }

            this.flushBufferedPartial(activeJob, attempt);
            if (attempt.controller.signal.aborted || !this.isCurrentAttempt(activeJob, attempt)) {
              return;
            }

            this.store.setResponseStatusPhase('decrypting', {
              responseJobId: request.jobId,
              turnState: 'responding',
            });
            attempt.didFinalize = this.store.finalizePendingResponse({
              responseJobId: request.jobId,
              handledUserTranscriptId: request.userTurn.id,
              responseTurns: turns,
            });
          },
          onError: (error) => {
            providerFailure = error;
          },
        },
        attempt.controller.signal,
      );

      if (providerFailure !== null) {
        throw providerFailure;
      }

      if (attempt.didFinalize) {
        return { status: 'finalized' };
      }

      if (attempt.timedOutBeforeVisible && !attempt.hasVisibleContent) {
        return {
          status: 'timed_out_before_visible',
          error: asProviderTimeoutError(candidate.name, timeoutMs ?? 0),
        };
      }

      if (attempt.controller.signal.aborted || activeJob.controller.signal.aborted) {
        return { status: 'aborted' };
      }

      return {
        status: attempt.hasVisibleContent ? 'failed_after_visible' : 'failed_before_visible',
        error: createAppError({
          category: 'state_error',
          code: `${candidate.name}_missing_final`,
          userMessage: `${candidate.name} finished without a final response.`,
        }),
      };
    } catch (error) {
      if (attempt.didFinalize) {
        return { status: 'finalized' };
      }

      if (attempt.timedOutBeforeVisible && !attempt.hasVisibleContent) {
        return {
          status: 'timed_out_before_visible',
          error: asProviderTimeoutError(candidate.name, timeoutMs ?? 0),
        };
      }

      if (attempt.controller.signal.aborted || activeJob.controller.signal.aborted) {
        return { status: 'aborted' };
      }

      return {
        status: attempt.hasVisibleContent ? 'failed_after_visible' : 'failed_before_visible',
        error,
      };
    }
  }

  private handlePartial(activeJob: ActiveResponseJob, attempt: ProviderAttempt, turn: ResponseProviderTurn) {
    if (!turn.text.trim()) {
      return;
    }

    if (!this.claimVisibleProvider(activeJob, attempt)) {
      return;
    }

    if (!attempt.hasVisibleContent) {
      return;
    }

    if (!this.isCurrentAttempt(activeJob, attempt) || attempt.controller.signal.aborted) {
      return;
    }

    if (!attempt.lastAppliedPartialText) {
      attempt.lastAppliedPartialText = turn.text;
      this.store.applyStreamingResponsePartial(activeJob.jobId, turn);
      return;
    }

    attempt.bufferedPartial = turn;
    if (attempt.partialTimer !== null) {
      return;
    }

    attempt.partialTimer = window.setTimeout(() => {
      attempt.partialTimer = null;
      this.flushBufferedPartial(activeJob, attempt);
    }, this.partialThrottleMs);
  }

  private claimVisibleProvider(activeJob: ActiveResponseJob, attempt: ProviderAttempt) {
    if (!this.isCurrentAttempt(activeJob, attempt) || attempt.controller.signal.aborted) {
      return false;
    }

    if (activeJob.winnerProviderName && activeJob.winnerProviderName !== attempt.name) {
      return false;
    }

    activeJob.winnerProviderName ??= attempt.name;
    attempt.hasVisibleContent = true;
    this.clearFirstVisibleTimer(attempt);
    return true;
  }

  private flushBufferedPartial(activeJob: ActiveResponseJob, attempt: ProviderAttempt) {
    if (!this.isCurrentAttempt(activeJob, attempt) || attempt.controller.signal.aborted) {
      attempt.bufferedPartial = null;
      return;
    }

    const pending = attempt.bufferedPartial;
    attempt.bufferedPartial = null;
    if (!pending || pending.text === attempt.lastAppliedPartialText) {
      return;
    }

    attempt.lastAppliedPartialText = pending.text;
    this.store.applyStreamingResponsePartial(activeJob.jobId, pending);
  }

  private clearFirstVisibleTimer(attempt: ProviderAttempt) {
    if (attempt.firstVisibleTimer !== null) {
      window.clearTimeout(attempt.firstVisibleTimer);
      attempt.firstVisibleTimer = null;
    }
  }

  private clearAttemptState(attempt: ProviderAttempt) {
    attempt.bufferedPartial = null;
    if (attempt.partialTimer !== null) {
      window.clearTimeout(attempt.partialTimer);
      attempt.partialTimer = null;
    }
    this.clearFirstVisibleTimer(attempt);
  }

  private cancelAttempt(attempt: ProviderAttempt | null) {
    if (!attempt) {
      return;
    }

    this.clearAttemptState(attempt);
    attempt.controller.abort();
  }

  private isActiveJob(activeJob: ActiveResponseJob, jobId: number) {
    return this.activeJob === activeJob && activeJob.jobId === jobId;
  }

  private isCurrentAttempt(activeJob: ActiveResponseJob, attempt: ProviderAttempt) {
    return this.activeJob === activeJob && activeJob.currentAttempt?.key === attempt.key;
  }

  private formatProviderError(error: unknown) {
    if (isAppError(error)) {
      return error.userMessage;
    }

    return toErrorMessage(error || 'Unable to generate a response.');
  }

  private cancelActiveJob(reason: string) {
    if (!this.activeJob) {
      return;
    }

    this.cancelAttempt(this.activeJob.currentAttempt);
    this.store.noteCleanup(`response-orchestrator:${reason}`);
    this.activeJob.controller.abort();
    this.activeJob = null;
  }
}

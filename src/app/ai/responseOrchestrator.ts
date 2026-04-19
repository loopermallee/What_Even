import { CONTACTS } from '../contacts';
import { isAppError, toErrorMessage } from '../errors';
import type { AppStore } from '../state';
import type { AppState } from '../types';
import { DeterministicResponseProvider } from './providers/deterministic';
import { GeminiResponseProvider } from './providers/gemini';
import type { ResponseGenerationRequest, ResponseProvider, ResponseProviderTurn } from './providers/base';

type ActiveResponseJob = {
  jobId: number;
  controller: AbortController;
  hasVisiblePartial: boolean;
  bufferedPartial: ResponseProviderTurn | null;
  lastAppliedPartialText: string;
  partialTimer: number | null;
};

type ResponseOrchestratorOptions = {
  primaryProvider?: ResponseProvider;
  fallbackProvider?: ResponseProvider | null;
};

export class ResponseOrchestrator {
  private readonly store: AppStore;
  private readonly primaryProvider: ResponseProvider;
  private readonly fallbackProvider: ResponseProvider | null;
  private activeJob: ActiveResponseJob | null = null;
  private readonly unsubscribe: (() => void);
  private readonly partialThrottleMs = 140;

  constructor(store: AppStore, options?: ResponseOrchestratorOptions) {
    this.store = store;
    this.primaryProvider = options?.primaryProvider ?? new GeminiResponseProvider();
    this.fallbackProvider = options?.fallbackProvider ?? new DeterministicResponseProvider();
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

    const contact = CONTACTS[state.selectedContactIndex];
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
    const controller = new AbortController();
    this.activeJob = {
      jobId: request.jobId,
      controller,
      hasVisiblePartial: false,
      bufferedPartial: null,
      lastAppliedPartialText: '',
      partialTimer: null,
    };

    void this.runJob(request, controller);
  }

  private async runJob(request: ResponseGenerationRequest, controller: AbortController) {
    const activeJob = this.activeJob;
    if (!activeJob) {
      return;
    }

    this.store.setResponseStatusPhase('sending', {
      responseJobId: request.jobId,
      turnState: 'processing_user',
    });

    try {
      await this.runProvider(this.primaryProvider, request, activeJob, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      if (this.shouldUseFallback(error, activeJob)) {
        this.store.log('Gemini provider failed before first visible reply. Falling back to deterministic response.');
        this.store.setResponseStatusPhase('sending', {
          responseJobId: request.jobId,
          turnState: 'processing_user',
        });

        try {
          await this.runProvider(this.fallbackProvider as ResponseProvider, request, activeJob, controller.signal);
          return;
        } catch (fallbackError) {
          if (controller.signal.aborted) {
            return;
          }

          this.store.failPendingResponse(request.jobId, this.formatProviderError(fallbackError));
          return;
        }
      }

      this.store.failPendingResponse(request.jobId, this.formatProviderError(error));
    } finally {
      this.clearBufferedPartial(activeJob);
      if (this.activeJob?.jobId === request.jobId) {
        this.activeJob = null;
      }
    }
  }

  private async runProvider(
    provider: ResponseProvider,
    request: ResponseGenerationRequest,
    activeJob: ActiveResponseJob,
    signal: AbortSignal,
  ) {
    let providerFailure: unknown = null;

    await provider.generate(
      request,
      {
        onPartial: (turn) => {
          this.handlePartial(activeJob, turn);
        },
        onFinal: ({ turns }) => {
          if (signal.aborted) {
            return;
          }

          this.flushBufferedPartial(activeJob);
          this.store.setResponseStatusPhase('decrypting', {
            responseJobId: request.jobId,
            turnState: 'responding',
          });
          this.store.finalizePendingResponse({
            responseJobId: request.jobId,
            handledUserTranscriptId: request.userTurn.id,
            responseTurns: turns,
          });
        },
        onError: (error) => {
          providerFailure = error;
        },
      },
      signal,
    );

    if (providerFailure !== null) {
      throw providerFailure;
    }
  }

  private handlePartial(activeJob: ActiveResponseJob, turn: ResponseProviderTurn) {
    if (this.activeJob?.jobId !== activeJob.jobId || activeJob.controller.signal.aborted) {
      return;
    }

    if (!turn.text.trim()) {
      return;
    }

    if (!activeJob.hasVisiblePartial) {
      activeJob.hasVisiblePartial = true;
      activeJob.lastAppliedPartialText = turn.text;
      this.store.applyStreamingResponsePartial(activeJob.jobId, turn);
      return;
    }

    activeJob.bufferedPartial = turn;
    if (activeJob.partialTimer !== null) {
      return;
    }

    activeJob.partialTimer = window.setTimeout(() => {
      activeJob.partialTimer = null;
      this.flushBufferedPartial(activeJob);
    }, this.partialThrottleMs);
  }

  private flushBufferedPartial(activeJob: ActiveResponseJob) {
    if (this.activeJob?.jobId !== activeJob.jobId || activeJob.controller.signal.aborted) {
      activeJob.bufferedPartial = null;
      return;
    }

    const pending = activeJob.bufferedPartial;
    activeJob.bufferedPartial = null;
    if (!pending || pending.text === activeJob.lastAppliedPartialText) {
      return;
    }

    activeJob.lastAppliedPartialText = pending.text;
    this.store.applyStreamingResponsePartial(activeJob.jobId, pending);
  }

  private clearBufferedPartial(activeJob: ActiveResponseJob) {
    activeJob.bufferedPartial = null;
    if (activeJob.partialTimer !== null) {
      window.clearTimeout(activeJob.partialTimer);
      activeJob.partialTimer = null;
    }
  }

  private shouldUseFallback(error: unknown, activeJob: ActiveResponseJob) {
    if (!this.fallbackProvider || activeJob.hasVisiblePartial) {
      return false;
    }

    if (!isAppError(error)) {
      return true;
    }

    return error.category === 'config_error'
      || error.category === 'auth_error'
      || error.category === 'network_error';
  }

  private formatProviderError(error: unknown) {
    if (isAppError(error)) {
      return error.userMessage;
    }

    return toErrorMessage(error);
  }

  private cancelActiveJob(reason: string) {
    if (!this.activeJob) {
      return;
    }

    this.clearBufferedPartial(this.activeJob);
    this.store.noteCleanup(`response-orchestrator:${reason}`);
    this.activeJob.controller.abort();
    this.activeJob = null;
  }
}

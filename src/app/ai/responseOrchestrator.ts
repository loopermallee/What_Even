import { CONTACTS } from '../contacts';
import type { AppStore } from '../state';
import type { AppState } from '../types';
import { DeterministicResponseProvider } from './providers/deterministic';
import type { ResponseGenerationRequest, ResponseProvider } from './providers/base';

type ActiveResponseJob = {
  jobId: number;
  handledUserTranscriptId: number;
  controller: AbortController;
};

export class ResponseOrchestrator {
  private readonly store: AppStore;
  private readonly provider: ResponseProvider;
  private activeJob: ActiveResponseJob | null = null;
  private readonly unsubscribe: (() => void);

  constructor(store: AppStore, provider: ResponseProvider = new DeterministicResponseProvider()) {
    this.store = store;
    this.provider = provider;
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
      handledUserTranscriptId: request.userTurn.id,
      controller,
    };

    void this.runJob(request, controller);
  }

  private async runJob(request: ResponseGenerationRequest, controller: AbortController) {
    this.store.setResponseStatusPhase('sending', {
      responseJobId: request.jobId,
      turnState: 'processing_user',
    });

    try {
      await this.provider.generate(
        request,
        {
          onPartial: (turn) => {
            this.store.applyStreamingResponsePartial(request.jobId, turn);
          },
          onFinal: ({ turns }) => {
            if (controller.signal.aborted) {
              return;
            }

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
            if (controller.signal.aborted) {
              return;
            }

            this.store.failPendingResponse(request.jobId, error);
          },
        },
        controller.signal
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      this.store.failPendingResponse(request.jobId, `Deterministic response failed: ${String(error)}`);
    } finally {
      if (this.activeJob?.jobId === request.jobId) {
        this.activeJob = null;
      }
    }
  }

  private cancelActiveJob(reason: string) {
    if (!this.activeJob) {
      return;
    }

    this.store.noteCleanup(`response-orchestrator:${reason}`);
    this.activeJob.controller.abort();
    this.activeJob = null;
  }
}

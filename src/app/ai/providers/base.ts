import type { AppError } from '../../errors';
import type { Contact, TranscriptEntry } from '../../types';

export type ResponseProviderTurn = Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>;

export type ResponseGenerationRequest = {
  jobId: number;
  contact: Contact;
  userTurn: TranscriptEntry;
  transcript: TranscriptEntry[];
};

export type ResponseProviderError = AppError | Error | string;

export type ResponseGenerationCallbacks = {
  onPartial: (turn: ResponseProviderTurn) => void;
  onFinal: (result: { turns: ResponseProviderTurn[] }) => void;
  onError: (error: ResponseProviderError) => void;
};

export interface ResponseProvider {
  generate(
    request: ResponseGenerationRequest,
    callbacks: ResponseGenerationCallbacks,
    signal: AbortSignal
  ): Promise<void>;
}

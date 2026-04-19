export const DEFAULT_GEMINI_BROKER_PATH = '/api/ai/respond';

export type GeminiTextPart = {
  text: string;
};

export type GeminiContent = {
  role?: 'user' | 'model';
  parts: GeminiTextPart[];
};

export type GeminiGenerateRequestBody = {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiTextPart[];
  };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
  };
};

export type GeminiBrokerRequestPayload = {
  jobId: number;
  request: GeminiGenerateRequestBody;
};

export type GeminiBrokerBufferedSuccessResponse = {
  ok: true;
  provider: 'gemini';
  deliveryMode: 'buffered_final';
  model: string;
  text: string;
};

export type GeminiBrokerFailureResponse = {
  ok: false;
  category?: string;
  code?: string;
  message?: string;
};

export type GeminiBrokerStreamStatusEvent = {
  provider: 'gemini';
  deliveryMode: 'native_stream';
  model: string;
  phase: 'receiving';
};

export type GeminiBrokerStreamPartialEvent = {
  provider: 'gemini';
  deliveryMode: 'native_stream';
  model: string;
  text: string;
};

export type GeminiBrokerStreamFinalEvent = {
  provider: 'gemini';
  deliveryMode: 'native_stream';
  model: string;
  text: string;
};

export type GeminiBrokerStreamErrorEvent = {
  category: string;
  code: string;
  message: string;
};

export type GeminiBrokerFinalResult = {
  provider: 'gemini';
  deliveryMode: 'native_stream' | 'buffered_final';
  model: string;
  text: string;
};

export const DEFAULT_OPENAI_BROKER_PATH = '/api/ai/openai/respond';

export type OpenAIResponsesInputText = {
  type: 'input_text';
  text: string;
};

export type OpenAIResponsesInputMessage = {
  type: 'message';
  role: 'developer' | 'user';
  content: OpenAIResponsesInputText[];
};

export type OpenAIResponsesRequestBody = {
  model: string;
  input: OpenAIResponsesInputMessage[];
  max_output_tokens?: number;
  temperature?: number;
  text?: {
    format: {
      type: 'text';
    };
  };
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high';
  };
  metadata?: Record<string, string>;
};

export type OpenAIBrokerRequestPayload = {
  jobId: number;
  request: OpenAIResponsesRequestBody;
};

export type OpenAIBrokerBufferedSuccessResponse = {
  ok: true;
  provider: 'openai';
  deliveryMode: 'buffered_final';
  model: string;
  text: string;
};

export type OpenAIBrokerFailureResponse = {
  ok: false;
  category?: string;
  code?: string;
  message?: string;
};

export type OpenAIBrokerStreamStatusEvent = {
  provider: 'openai';
  deliveryMode: 'native_stream';
  model: string;
  phase: 'receiving';
};

export type OpenAIBrokerStreamPartialEvent = {
  provider: 'openai';
  deliveryMode: 'native_stream';
  model: string;
  text: string;
};

export type OpenAIBrokerStreamFinalEvent = {
  provider: 'openai';
  deliveryMode: 'native_stream';
  model: string;
  text: string;
};

export type OpenAIBrokerStreamErrorEvent = {
  category: string;
  code: string;
  message: string;
};

export type OpenAIBrokerFinalResult = {
  provider: 'openai';
  deliveryMode: 'native_stream' | 'buffered_final';
  model: string;
  text: string;
};

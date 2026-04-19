import { createAppError, isErrorCategory, toErrorMessage } from '../errors';
import type { ErrorCategory } from '../types';
import {
  DEFAULT_GEMINI_BROKER_PATH,
  type GeminiBrokerBufferedSuccessResponse,
  type GeminiBrokerFailureResponse,
  type GeminiBrokerFinalResult,
  type GeminiBrokerRequestPayload,
  type GeminiBrokerStreamErrorEvent,
  type GeminiBrokerStreamFinalEvent,
  type GeminiBrokerStreamPartialEvent,
  type GeminiBrokerStreamStatusEvent,
} from './geminiContract';

type GeminiBrokerStreamHandlers = {
  onPartial: (event: GeminiBrokerStreamPartialEvent) => void;
};

function isAllowedBrokerUrl(value: string) {
  return value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://');
}

function asAbortError() {
  return new DOMException('The Gemini response request was aborted.', 'AbortError');
}

export function resolveGeminiBrokerUrl() {
  const override = String(import.meta.env.VITE_GEMINI_BROKER_URL ?? '').trim();
  if (!override) {
    return DEFAULT_GEMINI_BROKER_PATH;
  }

  if (!isAllowedBrokerUrl(override)) {
    throw createAppError({
      category: 'config_error',
      code: 'invalid_gemini_broker_url',
      userMessage: 'Gemini broker configuration is invalid.',
      detail: 'VITE_GEMINI_BROKER_URL must be a relative path or an absolute http(s) URL.',
    });
  }

  return override;
}

function normalizeBrokerErrorResponse(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerFailureResponse;
  if (parsed.ok !== false) {
    return null;
  }

  const category = String(parsed.category ?? '').trim();
  const code = String(parsed.code ?? '').trim();
  const message = String(parsed.message ?? '').trim();

  if (!category || !code || !message || !isErrorCategory(category)) {
    return null;
  }

  return {
    category,
    code,
    message,
  };
}

function normalizeBufferedSuccessResponse(payload: unknown): GeminiBrokerBufferedSuccessResponse | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerBufferedSuccessResponse;
  if (parsed.ok !== true || parsed.provider !== 'gemini' || parsed.deliveryMode !== 'buffered_final') {
    return null;
  }

  const model = String(parsed.model ?? '').trim();
  const text = String(parsed.text ?? '').trim();
  if (!model || !text) {
    return null;
  }

  return {
    ok: true,
    provider: 'gemini',
    deliveryMode: 'buffered_final',
    model,
    text,
  };
}

function normalizeStatusEvent(payload: unknown): GeminiBrokerStreamStatusEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerStreamStatusEvent;
  if (
    parsed.provider !== 'gemini'
    || parsed.deliveryMode !== 'native_stream'
    || parsed.phase !== 'receiving'
  ) {
    return null;
  }

  const model = String(parsed.model ?? '').trim();
  if (!model) {
    return null;
  }

  return {
    provider: 'gemini',
    deliveryMode: 'native_stream',
    phase: 'receiving',
    model,
  };
}

function normalizePartialEvent(payload: unknown): GeminiBrokerStreamPartialEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerStreamPartialEvent;
  if (parsed.provider !== 'gemini' || parsed.deliveryMode !== 'native_stream') {
    return null;
  }

  const model = String(parsed.model ?? '').trim();
  const text = String(parsed.text ?? '');
  if (!model || !text.trim()) {
    return null;
  }

  return {
    provider: 'gemini',
    deliveryMode: 'native_stream',
    model,
    text,
  };
}

function normalizeFinalEvent(payload: unknown): GeminiBrokerStreamFinalEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerStreamFinalEvent;
  if (parsed.provider !== 'gemini' || parsed.deliveryMode !== 'native_stream') {
    return null;
  }

  const model = String(parsed.model ?? '').trim();
  const text = String(parsed.text ?? '').trim();
  if (!model || !text) {
    return null;
  }

  return {
    provider: 'gemini',
    deliveryMode: 'native_stream',
    model,
    text,
  };
}

function normalizeStreamErrorEvent(payload: unknown): (GeminiBrokerStreamErrorEvent & { category: ErrorCategory }) | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerStreamErrorEvent;
  const category = String(parsed.category ?? '').trim();
  const code = String(parsed.code ?? '').trim();
  const message = String(parsed.message ?? '').trim();

  if (!category || !code || !message || !isErrorCategory(category)) {
    return null;
  }

  return {
    category: category as ErrorCategory,
    code,
    message,
  };
}

function parseSseBlock(block: string) {
  const normalized = block.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  let event = 'message';
  const dataLines: string[] = [];
  for (const line of normalized.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  return {
    event,
    data: dataLines.join('\n'),
  };
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readEventStream(
  response: Response,
  handlers: GeminiBrokerStreamHandlers,
  signal: AbortSignal,
): Promise<GeminiBrokerFinalResult> {
  if (!response.body) {
    throw createAppError({
      category: 'network_error',
      code: 'gemini_broker_missing_body',
      userMessage: 'Gemini broker returned an empty stream.',
      detail: 'ReadableStream body was missing.',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: GeminiBrokerFinalResult | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (signal.aborted) {
        throw asAbortError();
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex >= 0) {
        const block = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        const parsed = parseSseBlock(block);
        if (!parsed || !parsed.data) {
          continue;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(parsed.data);
        } catch {
          continue;
        }

        if (parsed.event === 'status') {
          normalizeStatusEvent(payload);
          continue;
        }

        if (parsed.event === 'partial') {
          const partial = normalizePartialEvent(payload);
          if (partial) {
            handlers.onPartial(partial);
          }
          continue;
        }

        if (parsed.event === 'final') {
          const finalEvent = normalizeFinalEvent(payload);
          if (finalEvent) {
            finalResult = {
              provider: 'gemini',
              deliveryMode: 'native_stream',
              model: finalEvent.model,
              text: finalEvent.text,
            };
            return finalResult;
          }
          continue;
        }

        if (parsed.event === 'error') {
          const brokerError = normalizeStreamErrorEvent(payload);
          if (brokerError) {
            throw createAppError({
              category: brokerError.category,
              code: brokerError.code,
              userMessage: brokerError.message,
            });
          }

          throw createAppError({
            category: 'network_error',
            code: 'gemini_broker_stream_error',
            userMessage: 'Gemini broker stream failed.',
          });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (finalResult) {
    return finalResult;
  }

  throw createAppError({
    category: 'network_error',
    code: 'gemini_broker_stream_incomplete',
    userMessage: 'Gemini stream ended before a final response arrived.',
  });
}

export async function requestGeminiBrokerResponse(
  payload: GeminiBrokerRequestPayload,
  handlers: GeminiBrokerStreamHandlers,
  signal: AbortSignal,
): Promise<GeminiBrokerFinalResult> {
  const url = resolveGeminiBrokerUrl();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw asAbortError();
    }

    throw createAppError({
      category: 'network_error',
      code: 'gemini_broker_unreachable',
      userMessage: 'Unable to reach Gemini broker service.',
      detail: toErrorMessage(error),
    });
  }

  if (!response.ok) {
    const payloadJson = await parseJsonSafe(response);
    const normalized = normalizeBrokerErrorResponse(payloadJson);
    if (normalized) {
      throw createAppError({
        category: normalized.category,
        code: normalized.code,
        userMessage: normalized.message,
        detail: `${response.status}`,
      });
    }

    throw createAppError({
      category: response.status >= 500 ? 'network_error' : 'auth_error',
      code: 'gemini_broker_request_failed',
      userMessage: 'Gemini broker request failed.',
      detail: `status=${response.status}`,
    });
  }

  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return readEventStream(response, handlers, signal);
  }

  if (!contentType.includes('application/json')) {
    throw createAppError({
      category: 'network_error',
      code: 'gemini_broker_invalid_content_type',
      userMessage: 'Gemini broker returned an unexpected response.',
      detail: `content-type=${contentType || 'none'}`,
    });
  }

  const payloadJson = await parseJsonSafe(response);
  const normalized = normalizeBufferedSuccessResponse(payloadJson);
  if (!normalized) {
    throw createAppError({
      category: 'network_error',
      code: 'gemini_broker_invalid_payload',
      userMessage: 'Gemini broker returned an invalid payload.',
    });
  }

  return {
    provider: 'gemini',
    deliveryMode: 'buffered_final',
    model: normalized.model,
    text: normalized.text,
  };
}

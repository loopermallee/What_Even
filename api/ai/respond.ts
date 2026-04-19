declare const process: {
  env: Record<string, string | undefined>;
};

import type { ErrorCategory } from '../../src/app/types';
import type {
  GeminiBrokerBufferedSuccessResponse,
  GeminiBrokerFailureResponse,
  GeminiBrokerRequestPayload,
  GeminiBrokerStreamErrorEvent,
} from '../../src/app/ai/geminiContract';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

type RateLimitEntry = {
  windowStart: number;
  count: number;
};

type UpstreamFailure = {
  status: number;
  category: ErrorCategory;
  code: string;
  message: string;
};

function parseRequiredEnv(name: string) {
  const value = String(process.env[name] ?? '').trim();
  return value || null;
}

function parsePositiveIntEnv(name: string, fallback: number) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer env: ${name}`);
  }

  return parsed;
}

function parseCorsAllowlist(value: string | undefined) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function sanitize(value: unknown) {
  return String(value)
    .replace(/(token|authorization|api[-_]?key|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[a-zA-Z0-9_-]{24,}\.[a-zA-Z0-9_-]{24,}\.[a-zA-Z0-9_-]{24,}\b/g, '[redacted-jwt]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted-token]');
}

function logEvent(event: string, details: Record<string, unknown> = {}) {
  const fields = Object.entries(details)
    .map(([key, value]) => `${key}=${sanitize(value)}`)
    .join(' ');
  const suffix = fields ? ` ${fields}` : '';
  console.log(`[gemini-respond] ${event}${suffix}`);
}

const config = (() => {
  const errors: string[] = [];
  const geminiApiKey = parseRequiredEnv('GEMINI_API_KEY');
  if (!geminiApiKey) {
    errors.push('missing_gemini_api_key');
  }

  let timeoutMs = 12_000;
  let rateLimitWindowMs = 60_000;
  let rateLimitMax = 20;
  let model = parseRequiredEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;

  try {
    timeoutMs = parsePositiveIntEnv('GEMINI_BROKER_TIMEOUT_MS', 12_000);
    rateLimitWindowMs = parsePositiveIntEnv('GEMINI_BROKER_RATE_LIMIT_WINDOW_MS', 60_000);
    rateLimitMax = parsePositiveIntEnv('GEMINI_BROKER_RATE_LIMIT_MAX', 20);
  } catch (error) {
    errors.push(sanitize(error));
  }

  model = model.trim() || DEFAULT_GEMINI_MODEL;

  return {
    geminiApiKey,
    timeoutMs,
    rateLimitWindowMs,
    rateLimitMax,
    model,
    corsAllowlist: parseCorsAllowlist(
      process.env.GEMINI_BROKER_CORS_ALLOWLIST ?? process.env.STT_BROKER_CORS_ALLOWLIST,
    ),
    configErrors: errors,
  };
})();

const rateLimiterState = new Map<string, RateLimitEntry>();

function nowMs() {
  return Date.now();
}

function getClientIp(request: Request) {
  const forwarded = String(request.headers.get('x-forwarded-for') ?? '').trim();
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  return String(request.headers.get('x-real-ip') ?? '').trim() || 'unknown';
}

function hitRateLimit(request: Request) {
  const ip = getClientIp(request);
  const current = nowMs();
  const existing = rateLimiterState.get(ip);

  if (!existing || current - existing.windowStart >= config.rateLimitWindowMs) {
    rateLimiterState.set(ip, { windowStart: current, count: 1 });
    return false;
  }

  if (existing.count >= config.rateLimitMax) {
    return true;
  }

  existing.count += 1;
  return false;
}

function requestOrigin(request: Request) {
  return String(request.headers.get('origin') ?? '').trim() || null;
}

function requestHost(request: Request) {
  const forwardedHost = String(request.headers.get('x-forwarded-host') ?? '').trim();
  if (forwardedHost) {
    return forwardedHost.split(',')[0]?.trim() || '';
  }

  return String(request.headers.get('host') ?? '').trim() || new URL(request.url).host;
}

function requestProto(request: Request) {
  const forwardedProto = String(request.headers.get('x-forwarded-proto') ?? '').trim();
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() || 'https';
  }

  return new URL(request.url).protocol.replace(/:$/, '') || 'https';
}

function sameOrigin(request: Request, origin: string | null) {
  if (!origin) {
    return true;
  }

  const host = requestHost(request);
  if (!host) {
    return false;
  }

  return origin === `${requestProto(request)}://${host}`;
}

function isCorsAllowed(request: Request, origin: string | null) {
  if (!origin) {
    return true;
  }

  if (sameOrigin(request, origin)) {
    return true;
  }

  return config.corsAllowlist.has(origin);
}

function applyCorsHeaders(headers: Headers, request: Request, origin: string | null) {
  if (origin && isCorsAllowed(request, origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
  }
}

function jsonResponse(
  request: Request,
  status: number,
  body: GeminiBrokerFailureResponse | GeminiBrokerBufferedSuccessResponse,
  origin = requestOrigin(request),
) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  applyCorsHeaders(headers, request, origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  request: Request,
  status: number,
  category: ErrorCategory,
  code: string,
  message: string,
) {
  return jsonResponse(request, status, {
    ok: false,
    category,
    code,
    message,
  });
}

function buildSseHeaders(request: Request) {
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  applyCorsHeaders(headers, request, requestOrigin(request));
  return headers;
}

function parseGeminiBrokerRequest(payload: unknown): GeminiBrokerRequestPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as GeminiBrokerRequestPayload;
  if (!Number.isFinite(parsed.jobId) || !parsed.request || typeof parsed.request !== 'object') {
    return null;
  }

  if (!Array.isArray(parsed.request.contents) || parsed.request.contents.length === 0) {
    return null;
  }

  return {
    jobId: Number(parsed.jobId),
    request: parsed.request,
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

function extractGeminiText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }

  const firstCandidate = candidates[0];
  if (!firstCandidate || typeof firstCandidate !== 'object') {
    return '';
  }

  const content = (firstCandidate as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') {
    return '';
  }

  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      return typeof (part as Record<string, unknown>).text === 'string'
        ? String((part as Record<string, unknown>).text)
        : '';
    })
    .join('')
    .trim();
}

function normalizeUpstreamErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') {
    return null;
  }

  const message = String((error as Record<string, unknown>).message ?? '').trim();
  return message || null;
}

function mergeStreamText(previous: string, incoming: string) {
  const next = String(incoming ?? '');
  if (!next.trim()) {
    return previous;
  }

  if (next.startsWith(previous)) {
    return next;
  }

  if (previous.startsWith(next) || previous.includes(next)) {
    return previous;
  }

  if (next.includes(previous)) {
    return next;
  }

  return `${previous}${next}`;
}

function mapUpstreamFailure(status: number, detail: string | null): UpstreamFailure {
  if (status === 401 || status === 403) {
    return {
      status: 502,
      category: 'auth_error',
      code: 'gemini_auth_failed',
      message: 'Gemini upstream rejected request.',
    };
  }

  if (status === 429) {
    return {
      status: 503,
      category: 'network_error',
      code: 'gemini_rate_limited',
      message: 'Gemini upstream is rate limited.',
    };
  }

  if (status >= 500) {
    return {
      status: 502,
      category: 'network_error',
      code: 'gemini_upstream_failed',
      message: 'Gemini upstream request failed.',
    };
  }

  return {
    status: 400,
    category: 'state_error',
    code: 'gemini_request_rejected',
    message: detail || 'Gemini request was rejected.',
  };
}

function toStreamErrorEvent(
  error: unknown,
  requestAborted: boolean,
  upstreamAborted: boolean,
): GeminiBrokerStreamErrorEvent {
  if (requestAborted) {
    return {
      category: 'network_error',
      code: 'client_disconnected',
      message: 'Client disconnected before Gemini finished responding.',
    };
  }

  if (upstreamAborted) {
    return {
      category: 'network_error',
      code: 'gemini_timeout',
      message: 'Gemini upstream timed out.',
    };
  }

  if (
    error
    && typeof error === 'object'
    && 'category' in error
    && 'code' in error
    && 'userMessage' in error
  ) {
    return {
      category: String((error as Record<string, unknown>).category) as ErrorCategory,
      code: String((error as Record<string, unknown>).code),
      message: String((error as Record<string, unknown>).userMessage),
    };
  }

  if (error instanceof Error && error.message) {
    return {
      category: 'network_error',
      code: 'gemini_stream_failed',
      message: error.message,
    };
  }

  return {
    category: 'network_error',
    code: 'gemini_stream_failed',
    message: 'Gemini stream failed.',
  };
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default async function handler(request: Request) {
  const origin = requestOrigin(request);

  if (origin && !isCorsAllowed(request, origin)) {
    return errorResponse(request, 403, 'auth_error', 'cors_forbidden_origin', 'Origin is not allowed.');
  }

  if (request.method === 'OPTIONS') {
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    applyCorsHeaders(headers, request, origin);
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return errorResponse(request, 405, 'state_error', 'method_not_allowed', 'Method not allowed.');
  }

  if (config.configErrors.length > 0 || !config.geminiApiKey) {
    return errorResponse(request, 503, 'config_error', 'gemini_broker_invalid_config', 'Gemini broker configuration is invalid.');
  }

  if (hitRateLimit(request)) {
    logEvent('rate_limited', { ip: getClientIp(request) });
    return errorResponse(request, 429, 'auth_error', 'rate_limited', 'Rate limit exceeded.');
  }

  const payload = await request.json().catch(() => null);
  const brokerRequest = parseGeminiBrokerRequest(payload);
  if (!brokerRequest) {
    return errorResponse(request, 400, 'state_error', 'invalid_payload', 'Gemini request payload is invalid.');
  }

  logEvent('request_started', {
    ip: getClientIp(request),
    jobId: brokerRequest.jobId,
    model: config.model,
  });

  const upstreamController = new AbortController();
  const abortUpstream = () => {
    upstreamController.abort();
  };
  const timeout = setTimeout(abortUpstream, config.timeoutMs);
  request.signal.addEventListener('abort', abortUpstream, { once: true });

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.geminiApiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify(brokerRequest.request),
        signal: upstreamController.signal,
      },
    );
  } catch (error) {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortUpstream);

    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    if (upstreamController.signal.aborted) {
      return errorResponse(request, 504, 'network_error', 'gemini_timeout', 'Gemini upstream timed out.');
    }

    logEvent('request_network_error', {
      ip: getClientIp(request),
      jobId: brokerRequest.jobId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(request, 502, 'network_error', 'gemini_network_error', 'Gemini upstream request failed.');
  }

  if (!upstreamResponse.ok) {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortUpstream);

    const errorPayload = await parseJsonSafe(upstreamResponse);
    const upstreamDetail = normalizeUpstreamErrorPayload(errorPayload);
    const mapped = mapUpstreamFailure(upstreamResponse.status, upstreamDetail);
    logEvent('request_rejected', {
      ip: getClientIp(request),
      jobId: brokerRequest.jobId,
      upstreamStatus: upstreamResponse.status,
    });
    return errorResponse(request, mapped.status, mapped.category, mapped.code, mapped.message);
  }

  const contentType = String(upstreamResponse.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortUpstream);

    const successPayload = await parseJsonSafe(upstreamResponse);
    const text = extractGeminiText(successPayload);
    if (!text) {
      return errorResponse(request, 502, 'state_error', 'gemini_empty_response', 'Gemini returned an empty response.');
    }

    logEvent('request_buffered_success', {
      ip: getClientIp(request),
      jobId: brokerRequest.jobId,
      model: config.model,
    });
    return jsonResponse(request, 200, {
      ok: true,
      provider: 'gemini',
      deliveryMode: 'buffered_final',
      model: config.model,
      text,
    });
  }

  if (!contentType.includes('text/event-stream') || !upstreamResponse.body) {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortUpstream);
    return errorResponse(request, 502, 'network_error', 'gemini_invalid_content_type', 'Gemini upstream returned an unexpected response.');
  }

  const upstreamReader = upstreamResponse.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let buffer = '';
      let assembledText = '';

      emit('status', {
        provider: 'gemini',
        deliveryMode: 'native_stream',
        model: config.model,
        phase: 'receiving',
      });

      try {
        while (true) {
          const { done, value } = await upstreamReader.read();
          if (done) {
            break;
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

            let eventPayload: unknown;
            try {
              eventPayload = JSON.parse(parsed.data);
            } catch {
              continue;
            }

            const upstreamError = normalizeUpstreamErrorPayload(eventPayload);
            if (upstreamError) {
              throw {
                category: 'network_error',
                code: 'gemini_stream_error',
                userMessage: upstreamError,
              };
            }

            const chunkText = extractGeminiText(eventPayload);
            const mergedText = mergeStreamText(assembledText, chunkText);
            if (mergedText.length > assembledText.length) {
              assembledText = mergedText;
              emit('partial', {
                provider: 'gemini',
                deliveryMode: 'native_stream',
                model: config.model,
                text: assembledText,
              });
            }
          }
        }

        if (buffer.trim()) {
          const parsed = parseSseBlock(buffer);
          if (parsed?.data) {
            const payload = JSON.parse(parsed.data) as unknown;
            const upstreamError = normalizeUpstreamErrorPayload(payload);
            if (upstreamError) {
              throw {
                category: 'network_error',
                code: 'gemini_stream_error',
                userMessage: upstreamError,
              };
            }

            const chunkText = extractGeminiText(payload);
            const mergedText = mergeStreamText(assembledText, chunkText);
            if (mergedText.length > assembledText.length) {
              assembledText = mergedText;
              emit('partial', {
                provider: 'gemini',
                deliveryMode: 'native_stream',
                model: config.model,
                text: assembledText,
              });
            }
          }
        }

        if (!assembledText.trim()) {
          emit('error', {
            category: 'state_error',
            code: 'gemini_empty_response',
            message: 'Gemini returned an empty response.',
          });
          controller.close();
          return;
        }

        emit('final', {
          provider: 'gemini',
          deliveryMode: 'native_stream',
          model: config.model,
          text: assembledText.trim(),
        });
        logEvent('request_stream_success', {
          ip: getClientIp(request),
          jobId: brokerRequest.jobId,
          model: config.model,
        });
        controller.close();
      } catch (error) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }

        emit('error', toStreamErrorEvent(error, request.signal.aborted, upstreamController.signal.aborted));
        controller.close();
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abortUpstream);
        upstreamReader.releaseLock();
      }
    },
    cancel() {
      upstreamController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: buildSseHeaders(request),
  });
}

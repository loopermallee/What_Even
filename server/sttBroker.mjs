import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEEPGRAM_AUTH_URL = 'https://api.deepgram.com/v1/auth/grant';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadLocalDotEnv() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let contents = '';
  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    console.warn(`[stt-broker] dotenv_load_failed path=${envPath}`);
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    process.env[key] = value;
  }
}

loadLocalDotEnv();

function parseRequiredEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  return value || null;
}

function parsePositiveIntEnv(name, fallback) {
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

function parseCorsAllowlist(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function mergeAllowlists(...allowlists) {
  const merged = new Set();
  for (const allowlist of allowlists) {
    for (const value of allowlist) {
      merged.add(value);
    }
  }

  return merged;
}

function sanitize(value) {
  return String(value)
    .replace(/(token|authorization|api[-_]?key|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[a-zA-Z0-9_-]{24,}\.[a-zA-Z0-9_-]{24,}\.[a-zA-Z0-9_-]{24,}\b/g, '[redacted-jwt]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted-token]');
}

function logEvent(event, details = {}) {
  const fields = Object.entries(details)
    .map(([key, value]) => `${key}=${sanitize(value)}`)
    .join(' ');
  const suffix = fields ? ` ${fields}` : '';
  console.log(`[stt-broker] ${event}${suffix}`);
}

const config = (() => {
  const sttErrors = [];
  const geminiErrors = [];

  const deepgramApiKey = parseRequiredEnv('DEEPGRAM_API_KEY');
  if (!deepgramApiKey) {
    sttErrors.push('missing_deepgram_api_key');
  }

  const geminiApiKey = parseRequiredEnv('GEMINI_API_KEY');
  if (!geminiApiKey) {
    geminiErrors.push('missing_gemini_api_key');
  }

  let port = 8787;
  let sttTimeoutMs = 5000;
  let sttRateLimitWindowMs = 60_000;
  let sttRateLimitMax = 30;
  let tokenTtlSeconds = 60;
  let geminiTimeoutMs = 12_000;
  let geminiRateLimitWindowMs = 60_000;
  let geminiRateLimitMax = 20;
  let geminiModel = parseRequiredEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;

  try {
    port = parsePositiveIntEnv('STT_BROKER_PORT', 8787);
    sttTimeoutMs = parsePositiveIntEnv('STT_BROKER_TIMEOUT_MS', 5000);
    sttRateLimitWindowMs = parsePositiveIntEnv('STT_BROKER_RATE_LIMIT_WINDOW_MS', 60_000);
    sttRateLimitMax = parsePositiveIntEnv('STT_BROKER_RATE_LIMIT_MAX', 30);
    tokenTtlSeconds = parsePositiveIntEnv('DEEPGRAM_TOKEN_TTL_SECONDS', 60);
    geminiTimeoutMs = parsePositiveIntEnv('GEMINI_BROKER_TIMEOUT_MS', 12_000);
    geminiRateLimitWindowMs = parsePositiveIntEnv('GEMINI_BROKER_RATE_LIMIT_WINDOW_MS', 60_000);
    geminiRateLimitMax = parsePositiveIntEnv('GEMINI_BROKER_RATE_LIMIT_MAX', 20);
  } catch (error) {
    const sanitized = sanitize(error);
    sttErrors.push(sanitized);
    geminiErrors.push(sanitized);
  }

  geminiModel = geminiModel.trim() || DEFAULT_GEMINI_MODEL;

  return {
    port,
    corsAllowlist: mergeAllowlists(
      parseCorsAllowlist(process.env.STT_BROKER_CORS_ALLOWLIST),
      parseCorsAllowlist(process.env.GEMINI_BROKER_CORS_ALLOWLIST),
    ),
    stt: {
      deepgramApiKey,
      timeoutMs: sttTimeoutMs,
      rateLimitWindowMs: sttRateLimitWindowMs,
      rateLimitMax: sttRateLimitMax,
      tokenTtlSeconds,
      configErrors: sttErrors,
    },
    gemini: {
      geminiApiKey,
      timeoutMs: geminiTimeoutMs,
      rateLimitWindowMs: geminiRateLimitWindowMs,
      rateLimitMax: geminiRateLimitMax,
      model: geminiModel,
      configErrors: geminiErrors,
    },
  };
})();

const sttRateLimiterState = new Map();
const geminiRateLimiterState = new Map();

function nowMs() {
  return Date.now();
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim() || 'unknown';
  }

  return req.socket.remoteAddress || 'unknown';
}

function hitRateLimit(req, state, windowMs, maxCount) {
  const ip = getClientIp(req);
  const current = nowMs();
  const existing = state.get(ip);

  if (!existing || current - existing.windowStart >= windowMs) {
    state.set(ip, { windowStart: current, count: 1 });
    return false;
  }

  if (existing.count >= maxCount) {
    return true;
  }

  existing.count += 1;
  return false;
}

function requestOrigin(req) {
  return String(req.headers.origin ?? '').trim() || null;
}

function sameOrigin(req, origin) {
  if (!origin) {
    return true;
  }

  const host = String(req.headers.host ?? '').trim();
  if (!host) {
    return false;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || 'http';
  return origin === `${proto}://${host}`;
}

function isCorsAllowed(req, origin) {
  if (!origin) {
    return true;
  }

  if (sameOrigin(req, origin)) {
    return true;
  }

  return config.corsAllowlist.has(origin);
}

function applyCorsHeaders(req, res, origin) {
  if (origin && isCorsAllowed(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  }
}

function sendJson(req, res, status, body) {
  const origin = requestOrigin(req);
  applyCorsHeaders(req, res, origin);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendError(req, res, status, category, code, message) {
  sendJson(req, res, status, {
    ok: false,
    category,
    code,
    message,
  });
}

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseSseBlock(block) {
  const normalized = block.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  let event = 'message';
  const dataLines = [];
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

function extractGeminiText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }

  const firstCandidate = candidates[0];
  if (!firstCandidate || typeof firstCandidate !== 'object') {
    return '';
  }

  const content = firstCandidate.content;
  if (!content || typeof content !== 'object') {
    return '';
  }

  const parts = content.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      return typeof part.text === 'string' ? String(part.text) : '';
    })
    .join('')
    .trim();
}

function normalizeGeminiUpstreamError(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = payload.error;
  if (!error || typeof error !== 'object') {
    return null;
  }

  const message = String(error.message ?? '').trim();
  return message || null;
}

function mergeStreamText(previous, incoming) {
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

function mapGeminiUpstreamFailure(status, detail) {
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

function toGeminiStreamError(error, requestAborted, upstreamAborted) {
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
      category: String(error.category),
      code: String(error.code),
      message: String(error.userMessage),
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

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readJsonBody(req, maxBytes = 128_000) {
  return await new Promise((resolve, reject) => {
    let body = '';
    let settled = false;

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        rejectOnce(new Error('body_too_large'));
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolveOnce(null);
        return;
      }

      try {
        resolveOnce(JSON.parse(body));
      } catch {
        resolveOnce(null);
      }
    });

    req.on('error', rejectOnce);
  });
}

function parseGeminiBrokerRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const jobId = Number(payload.jobId);
  const request = payload.request;
  if (!Number.isFinite(jobId) || !request || typeof request !== 'object') {
    return null;
  }

  if (!Array.isArray(request.contents) || request.contents.length === 0) {
    return null;
  }

  return {
    jobId,
    request,
  };
}

async function issueDeepgramToken() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.stt.timeoutMs);

  try {
    const response = await fetch(DEEPGRAM_AUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.stt.deepgramApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ttl: config.stt.tokenTtlSeconds }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
      };
    }

    const payload = await response.json().catch(() => null);
    const accessToken = String(payload?.access_token ?? payload?.token ?? '').trim();
    if (!accessToken) {
      return {
        ok: false,
        status: 502,
      };
    }

    const expiresIn = Number.parseInt(String(payload?.expires_in ?? ''), 10);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + (expiresIn * 1000)).toISOString()
      : undefined;

    return {
      ok: true,
      accessToken,
      expiresAt,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      return {
        ok: false,
        timedOut: true,
      };
    }

    return {
      ok: false,
      network: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSttAuth(req, res, origin) {
  if (origin && !isCorsAllowed(req, origin)) {
    sendError(req, res, 403, 'auth_error', 'cors_forbidden_origin', 'Origin is not allowed.');
    return;
  }

  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res, origin);
    res.statusCode = 204;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(req, res, 405, 'state_error', 'method_not_allowed', 'Method not allowed.');
    return;
  }

  if (config.stt.configErrors.length > 0 || !config.stt.deepgramApiKey) {
    sendError(req, res, 503, 'config_error', 'broker_invalid_config', 'Broker configuration is invalid.');
    return;
  }

  if (hitRateLimit(req, sttRateLimiterState, config.stt.rateLimitWindowMs, config.stt.rateLimitMax)) {
    logEvent('rate_limited', { ip: getClientIp(req), route: 'stt' });
    sendError(req, res, 429, 'auth_error', 'rate_limited', 'Rate limit exceeded.');
    return;
  }

  logEvent('auth_request_started', { ip: getClientIp(req) });
  const issued = await issueDeepgramToken();

  if (!issued.ok) {
    if ('timedOut' in issued && issued.timedOut) {
      logEvent('auth_request_timeout', { ip: getClientIp(req), timeoutMs: config.stt.timeoutMs });
      sendError(req, res, 504, 'network_error', 'deepgram_timeout', 'Speech auth upstream timed out.');
      return;
    }

    if ('network' in issued && issued.network) {
      logEvent('auth_request_network_error', { ip: getClientIp(req) });
      sendError(req, res, 502, 'network_error', 'deepgram_network_error', 'Speech auth upstream request failed.');
      return;
    }

    logEvent('auth_request_rejected', { ip: getClientIp(req), upstreamStatus: issued.status });
    sendError(req, res, 502, 'auth_error', 'deepgram_auth_failed', 'Speech auth upstream rejected request.');
    return;
  }

  logEvent('auth_request_succeeded', { ip: getClientIp(req) });
  sendJson(req, res, 200, {
    ok: true,
    accessToken: issued.accessToken,
    ...(issued.expiresAt ? { expiresAt: issued.expiresAt } : {}),
  });
}

async function handleGeminiRespond(req, res, origin) {
  if (origin && !isCorsAllowed(req, origin)) {
    sendError(req, res, 403, 'auth_error', 'cors_forbidden_origin', 'Origin is not allowed.');
    return;
  }

  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res, origin);
    res.statusCode = 204;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(req, res, 405, 'state_error', 'method_not_allowed', 'Method not allowed.');
    return;
  }

  if (config.gemini.configErrors.length > 0 || !config.gemini.geminiApiKey) {
    sendError(req, res, 503, 'config_error', 'gemini_broker_invalid_config', 'Gemini broker configuration is invalid.');
    return;
  }

  if (hitRateLimit(req, geminiRateLimiterState, config.gemini.rateLimitWindowMs, config.gemini.rateLimitMax)) {
    logEvent('rate_limited', { ip: getClientIp(req), route: 'gemini' });
    sendError(req, res, 429, 'auth_error', 'rate_limited', 'Rate limit exceeded.');
    return;
  }

  const payload = await readJsonBody(req).catch(() => null);
  const brokerRequest = parseGeminiBrokerRequest(payload);
  if (!brokerRequest) {
    sendError(req, res, 400, 'state_error', 'invalid_payload', 'Gemini request payload is invalid.');
    return;
  }

  logEvent('gemini_request_started', {
    ip: getClientIp(req),
    jobId: brokerRequest.jobId,
    model: config.gemini.model,
  });

  const upstreamController = new AbortController();
  const abortUpstream = () => {
    upstreamController.abort();
  };
  const timeout = setTimeout(abortUpstream, config.gemini.timeoutMs);
  req.on('close', abortUpstream);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.gemini.geminiApiKey)}`,
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
    req.off('close', abortUpstream);

    if (req.destroyed || res.destroyed) {
      return;
    }

    if (upstreamController.signal.aborted) {
      sendError(req, res, 504, 'network_error', 'gemini_timeout', 'Gemini upstream timed out.');
      return;
    }

    logEvent('gemini_request_network_error', {
      ip: getClientIp(req),
      jobId: brokerRequest.jobId,
      detail: error instanceof Error ? error.message : String(error),
    });
    sendError(req, res, 502, 'network_error', 'gemini_network_error', 'Gemini upstream request failed.');
    return;
  }

  if (!upstreamResponse.ok) {
    clearTimeout(timeout);
    req.off('close', abortUpstream);

    const errorPayload = await parseJsonSafe(upstreamResponse);
    const upstreamDetail = normalizeGeminiUpstreamError(errorPayload);
    const mapped = mapGeminiUpstreamFailure(upstreamResponse.status, upstreamDetail);
    logEvent('gemini_request_rejected', {
      ip: getClientIp(req),
      jobId: brokerRequest.jobId,
      upstreamStatus: upstreamResponse.status,
    });
    sendError(req, res, mapped.status, mapped.category, mapped.code, mapped.message);
    return;
  }

  const contentType = String(upstreamResponse.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    clearTimeout(timeout);
    req.off('close', abortUpstream);

    const successPayload = await parseJsonSafe(upstreamResponse);
    const text = extractGeminiText(successPayload);
    if (!text) {
      sendError(req, res, 502, 'state_error', 'gemini_empty_response', 'Gemini returned an empty response.');
      return;
    }

    logEvent('gemini_request_buffered_success', {
      ip: getClientIp(req),
      jobId: brokerRequest.jobId,
      model: config.gemini.model,
    });
    sendJson(req, res, 200, {
      ok: true,
      provider: 'gemini',
      deliveryMode: 'buffered_final',
      model: config.gemini.model,
      text,
    });
    return;
  }

  if (!contentType.includes('text/event-stream') || !upstreamResponse.body) {
    clearTimeout(timeout);
    req.off('close', abortUpstream);
    sendError(req, res, 502, 'network_error', 'gemini_invalid_content_type', 'Gemini upstream returned an unexpected response.');
    return;
  }

  applyCorsHeaders(req, res, origin);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const upstreamReader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assembledText = '';

  sendSseEvent(res, 'status', {
    provider: 'gemini',
    deliveryMode: 'native_stream',
    model: config.gemini.model,
    phase: 'receiving',
  });

  try {
    while (true) {
      const { done, value } = await upstreamReader.read();
      if (done) {
        break;
      }

      if (req.destroyed || res.destroyed) {
        upstreamController.abort();
        return;
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

        let eventPayload;
        try {
          eventPayload = JSON.parse(parsed.data);
        } catch {
          continue;
        }

        const upstreamError = normalizeGeminiUpstreamError(eventPayload);
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
          sendSseEvent(res, 'partial', {
            provider: 'gemini',
            deliveryMode: 'native_stream',
            model: config.gemini.model,
            text: assembledText,
          });
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed?.data) {
        const payload = JSON.parse(parsed.data);
        const upstreamError = normalizeGeminiUpstreamError(payload);
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
          sendSseEvent(res, 'partial', {
            provider: 'gemini',
            deliveryMode: 'native_stream',
            model: config.gemini.model,
            text: assembledText,
          });
        }
      }
    }

    if (!assembledText.trim()) {
      sendSseEvent(res, 'error', {
        category: 'state_error',
        code: 'gemini_empty_response',
        message: 'Gemini returned an empty response.',
      });
      res.end();
      return;
    }

    sendSseEvent(res, 'final', {
      provider: 'gemini',
      deliveryMode: 'native_stream',
      model: config.gemini.model,
      text: assembledText.trim(),
    });
    logEvent('gemini_request_stream_success', {
      ip: getClientIp(req),
      jobId: brokerRequest.jobId,
      model: config.gemini.model,
    });
    res.end();
  } catch (error) {
    if (!req.destroyed && !res.destroyed) {
      sendSseEvent(res, 'error', toGeminiStreamError(error, req.destroyed, upstreamController.signal.aborted));
      res.end();
    }
  } finally {
    clearTimeout(timeout);
    req.off('close', abortUpstream);
    upstreamReader.releaseLock();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const origin = requestOrigin(req);

  if (url.pathname === '/api/stt/auth') {
    await handleSttAuth(req, res, origin);
    return;
  }

  if (url.pathname === '/api/ai/respond') {
    await handleGeminiRespond(req, res, origin);
    return;
  }

  sendError(req, res, 404, 'state_error', 'route_not_found', 'Route not found.');
});

server.listen(config.port, () => {
  logEvent('started', {
    port: config.port,
    sttConfigErrors: config.stt.configErrors.length,
    geminiConfigErrors: config.gemini.configErrors.length,
    corsAllowlistSize: config.corsAllowlist.size,
    geminiModel: config.gemini.model,
  });
});

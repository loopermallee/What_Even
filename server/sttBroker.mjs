import http from 'node:http';

const DEEPGRAM_AUTH_URL = 'https://api.deepgram.com/v1/auth/grant';

function parseRequiredEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    return null;
  }

  return value;
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
      .filter(Boolean)
  );
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
  const errors = [];
  const deepgramApiKey = parseRequiredEnv('DEEPGRAM_API_KEY');
  if (!deepgramApiKey) {
    errors.push('missing_deepgram_api_key');
  }

  let port = 8787;
  let timeoutMs = 5000;
  let rateLimitWindowMs = 60_000;
  let rateLimitMax = 30;
  let tokenTtlSeconds = 60;
  try {
    port = parsePositiveIntEnv('STT_BROKER_PORT', 8787);
    timeoutMs = parsePositiveIntEnv('STT_BROKER_TIMEOUT_MS', 5000);
    rateLimitWindowMs = parsePositiveIntEnv('STT_BROKER_RATE_LIMIT_WINDOW_MS', 60_000);
    rateLimitMax = parsePositiveIntEnv('STT_BROKER_RATE_LIMIT_MAX', 30);
    tokenTtlSeconds = parsePositiveIntEnv('DEEPGRAM_TOKEN_TTL_SECONDS', 60);
  } catch (error) {
    errors.push(sanitize(error));
  }

  const corsAllowlist = parseCorsAllowlist(process.env.STT_BROKER_CORS_ALLOWLIST);

  return {
    deepgramApiKey,
    port,
    timeoutMs,
    rateLimitWindowMs,
    rateLimitMax,
    tokenTtlSeconds,
    corsAllowlist,
    configErrors: errors,
  };
})();

const rateLimiterState = new Map();

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

function hitRateLimit(req) {
  const ip = getClientIp(req);
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

async function issueDeepgramToken() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(DEEPGRAM_AUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ttl: config.tokenTtlSeconds }),
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const origin = requestOrigin(req);

  if (url.pathname !== '/api/stt/auth') {
    sendError(req, res, 404, 'state_error', 'route_not_found', 'Route not found.');
    return;
  }

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

  if (config.configErrors.length > 0 || !config.deepgramApiKey) {
    sendError(req, res, 503, 'config_error', 'broker_invalid_config', 'Broker configuration is invalid.');
    return;
  }

  if (hitRateLimit(req)) {
    logEvent('rate_limited', { ip: getClientIp(req) });
    sendError(req, res, 429, 'auth_error', 'rate_limited', 'Rate limit exceeded.');
    return;
  }

  logEvent('auth_request_started', { ip: getClientIp(req) });
  const issued = await issueDeepgramToken();

  if (!issued.ok) {
    if ('timedOut' in issued && issued.timedOut) {
      logEvent('auth_request_timeout', { ip: getClientIp(req), timeoutMs: config.timeoutMs });
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
});

server.listen(config.port, () => {
  logEvent('started', {
    port: config.port,
    timeoutMs: config.timeoutMs,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitMax: config.rateLimitMax,
    corsAllowlistSize: config.corsAllowlist.size,
    configErrors: config.configErrors.length,
  });
});

declare const process: {
  env: Record<string, string | undefined>;
};

const DEEPGRAM_AUTH_URL = 'https://api.deepgram.com/v1/auth/grant';

type ErrorBody = {
  ok: false;
  category: string;
  code: string;
  message: string;
};

type SuccessBody = {
  ok: true;
  accessToken: string;
  expiresAt?: string;
};

type DeepgramTokenResult =
  | {
    ok: true;
    accessToken: string;
    expiresAt?: string;
  }
  | {
    ok: false;
    status: number;
    timedOut?: never;
    network?: never;
  }
  | {
    ok: false;
    timedOut: true;
    status?: never;
    network?: never;
  }
  | {
    ok: false;
    network: true;
    status?: never;
    timedOut?: never;
  };

type RateLimitEntry = {
  windowStart: number;
  count: number;
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
  console.log(`[stt-auth] ${event}${suffix}`);
}

const config = (() => {
  const errors: string[] = [];
  const deepgramApiKey = parseRequiredEnv('DEEPGRAM_API_KEY');
  if (!deepgramApiKey) {
    errors.push('missing_deepgram_api_key');
  }

  let timeoutMs = 5000;
  let rateLimitWindowMs = 60_000;
  let rateLimitMax = 30;
  let tokenTtlSeconds = 60;

  try {
    timeoutMs = parsePositiveIntEnv('STT_BROKER_TIMEOUT_MS', 5000);
    rateLimitWindowMs = parsePositiveIntEnv('STT_BROKER_RATE_LIMIT_WINDOW_MS', 60_000);
    rateLimitMax = parsePositiveIntEnv('STT_BROKER_RATE_LIMIT_MAX', 30);
    tokenTtlSeconds = parsePositiveIntEnv('DEEPGRAM_TOKEN_TTL_SECONDS', 60);
  } catch (error) {
    errors.push(sanitize(error));
  }

  return {
    deepgramApiKey,
    timeoutMs,
    rateLimitWindowMs,
    rateLimitMax,
    tokenTtlSeconds,
    corsAllowlist: parseCorsAllowlist(process.env.STT_BROKER_CORS_ALLOWLIST),
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
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function jsonResponse(
  request: Request,
  status: number,
  body: ErrorBody | SuccessBody,
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
  category: string,
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

async function issueDeepgramToken(): Promise<DeepgramTokenResult> {
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
    const accessToken = String(
      (payload as { access_token?: string; token?: string } | null)?.access_token
      ?? (payload as { access_token?: string; token?: string } | null)?.token
      ?? '',
    ).trim();

    if (!accessToken) {
      return {
        ok: false,
        status: 502,
      };
    }

    const expiresIn = Number.parseInt(
      String((payload as { expires_in?: number | string } | null)?.expires_in ?? ''),
      10,
    );
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

async function handleRequest(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);

  if (url.pathname !== '/api/stt/auth') {
    return errorResponse(request, 404, 'state_error', 'route_not_found', 'Route not found.');
  }

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

  if (config.configErrors.length > 0 || !config.deepgramApiKey) {
    return errorResponse(
      request,
      503,
      'config_error',
      'broker_invalid_config',
      'Broker configuration is invalid.',
    );
  }

  if (hitRateLimit(request)) {
    logEvent('rate_limited', { ip: getClientIp(request) });
    return errorResponse(request, 429, 'auth_error', 'rate_limited', 'Rate limit exceeded.');
  }

  logEvent('auth_request_started', { ip: getClientIp(request) });
  const issued = await issueDeepgramToken();

  if (!issued.ok) {
    if ('timedOut' in issued && issued.timedOut) {
      logEvent('auth_request_timeout', { ip: getClientIp(request), timeoutMs: config.timeoutMs });
      return errorResponse(
        request,
        504,
        'network_error',
        'deepgram_timeout',
        'Speech auth upstream timed out.',
      );
    }

    if ('network' in issued && issued.network) {
      logEvent('auth_request_network_error', { ip: getClientIp(request) });
      return errorResponse(
        request,
        502,
        'network_error',
        'deepgram_network_error',
        'Speech auth upstream request failed.',
      );
    }

    logEvent('auth_request_rejected', { ip: getClientIp(request), upstreamStatus: issued.status });
    return errorResponse(
      request,
      502,
      'auth_error',
      'deepgram_auth_failed',
      'Speech auth upstream rejected request.',
    );
  }

  logEvent('auth_request_succeeded', { ip: getClientIp(request) });
  return jsonResponse(request, 200, {
    ok: true,
    accessToken: issued.accessToken,
    ...(issued.expiresAt ? { expiresAt: issued.expiresAt } : {}),
  });
}

export default {
  async fetch(request: Request) {
    return handleRequest(request);
  },
};

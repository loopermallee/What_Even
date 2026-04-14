import { createAppError, isErrorCategory, toErrorMessage } from '../app/errors';

const DEFAULT_STT_BROKER_PATH = '/api/stt/auth';

type BrokerSuccessResponse = {
  ok: true;
  accessToken: string;
  expiresAt?: string;
};

type BrokerFailureResponse = {
  ok: false;
  category?: string;
  code?: string;
  message?: string;
};

export type BrokerAuthResult = {
  accessToken: string;
  expiresAt?: string;
};

function isAllowedBrokerUrl(value: string) {
  return value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://');
}

export function resolveSttBrokerAuthUrl() {
  const override = String(import.meta.env.VITE_STT_BROKER_URL ?? '').trim();
  if (!override) {
    return DEFAULT_STT_BROKER_PATH;
  }

  if (!isAllowedBrokerUrl(override)) {
    throw createAppError({
      category: 'config_error',
      code: 'invalid_stt_broker_url',
      userMessage: 'STT broker configuration is invalid.',
      detail: 'VITE_STT_BROKER_URL must be a relative path or an absolute http(s) URL.',
    });
  }

  return override;
}

function normalizeBrokerErrorResponse(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as BrokerFailureResponse;
  if (parsed.ok !== false) {
    return null;
  }

  const category = String(parsed.category ?? '').trim();
  const code = String(parsed.code ?? '').trim();
  const message = String(parsed.message ?? '').trim();

  if (!category || !code || !message) {
    return null;
  }

  if (!isErrorCategory(category)) {
    return null;
  }

  return {
    category,
    code,
    message,
  };
}

function normalizeBrokerSuccessResponse(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsed = payload as BrokerSuccessResponse;
  if (parsed.ok !== true) {
    return null;
  }

  const accessToken = String(parsed.accessToken ?? '').trim();
  if (!accessToken) {
    return null;
  }

  const expiresAt = typeof parsed.expiresAt === 'string' && parsed.expiresAt.trim().length > 0
    ? parsed.expiresAt.trim()
    : undefined;

  return {
    accessToken,
    expiresAt,
  };
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function requestSttBrokerAuth(): Promise<BrokerAuthResult> {
  const url = resolveSttBrokerAuthUrl();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ purpose: 'realtime_stt' }),
    });
  } catch (error) {
    throw createAppError({
      category: 'network_error',
      code: 'broker_unreachable',
      userMessage: 'Unable to reach speech auth service.',
      detail: toErrorMessage(error),
    });
  }

  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw createAppError({
      category: 'stt_error',
      code: 'broker_invalid_content_type',
      userMessage: 'Speech auth service returned an invalid response.',
      detail: `Unexpected content-type: ${contentType || 'none'}`,
    });
  }

  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    const normalized = normalizeBrokerErrorResponse(payload);
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
      code: 'broker_request_failed',
      userMessage: 'Speech auth service is unavailable.',
      detail: `status=${response.status}`,
    });
  }

  const normalized = normalizeBrokerSuccessResponse(payload);
  if (!normalized) {
    throw createAppError({
      category: 'stt_error',
      code: 'broker_invalid_payload',
      userMessage: 'Speech auth data was invalid.',
      detail: 'Broker success payload missing accessToken.',
    });
  }

  return normalized;
}

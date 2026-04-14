import type { ErrorCategory } from './types';

export type AppError = {
  category: ErrorCategory;
  code: string;
  userMessage: string;
  detail?: string;
};

export function isErrorCategory(value: string): value is ErrorCategory {
  return value === 'config_error'
    || value === 'auth_error'
    || value === 'network_error'
    || value === 'stt_error'
    || value === 'mic_error'
    || value === 'session_error'
    || value === 'state_error'
    || value === 'unknown_error';
}

export function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isErrorCategory(String(record.category ?? ''))
    && typeof record.code === 'string'
    && typeof record.userMessage === 'string';
}

export function createAppError(input: AppError): AppError {
  return {
    category: input.category,
    code: input.code,
    userMessage: input.userMessage,
    detail: input.detail,
  };
}

export function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export function redactSensitiveText(value: string) {
  return value
    .replace(/(token|authorization|api[-_]?key|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[a-zA-Z0-9_-]{24,}\.[a-zA-Z0-9_-]{24,}\.[a-zA-Z0-9_-]{24,}\b/g, '[redacted-jwt]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted-token]');
}

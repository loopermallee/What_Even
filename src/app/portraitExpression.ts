import type { CodecExpression, TranscriptEntry } from './types';

type ExpressionResolutionInput = {
  text: string;
  explicitEmotion?: CodecExpression;
  role?: TranscriptEntry['role'] | null;
  fallback?: CodecExpression;
};

const SURPRISED_PATTERNS = [
  /\bwhat\b/,
  /\bno\b/,
  /\bimpossible\b/,
  /\bwho\b/,
  /\bwhy\b/,
  /\bwait\b/,
];

const ANGRY_PATTERNS = [
  /\bdamn\b/,
  /\bhurry\b/,
  /\bmove\b/,
  /\btarget\b/,
  /\bnow\b/,
  /\bgo\b/,
  /\balert\b/,
];

const THINKING_PATTERNS = [
  /\bthink\b/,
  /\bunderstood\b/,
  /\bconsider\b/,
  /\bcheck\b/,
  /\bmaybe\b/,
  /\bhold\b/,
  /\bwait\b/,
];

const HURT_PATTERNS = [
  /\bhit\b/,
  /\bhurt\b/,
  /\binjured\b/,
  /\bpain\b/,
  /\bdamaged\b/,
  /\bbleeding\b/,
];

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function getFallbackExpression(role?: TranscriptEntry['role'] | null, fallback: CodecExpression = 'idle') {
  if (fallback !== 'idle') {
    return fallback;
  }

  if (role === 'system') {
    return 'stern';
  }

  return 'idle';
}

export function resolveCodecExpression(input: ExpressionResolutionInput): CodecExpression {
  if (input.explicitEmotion) {
    return input.explicitEmotion;
  }

  const normalized = input.text.trim().toLowerCase();
  const fallback = getFallbackExpression(input.role, input.fallback);
  if (!normalized) {
    return fallback;
  }

  const scores: Record<CodecExpression, number> = {
    idle: 0,
    stern: 0,
    angry: 0,
    surprised: 0,
    thinking: 0,
    hurt: 0,
  };

  if (normalized.includes('?!') || normalized.includes('!?')) {
    scores.surprised += 3;
  }
  if (normalized.includes('...')) {
    scores.thinking += 2;
  }
  if ((normalized.match(/!/g) ?? []).length >= 1) {
    scores.surprised += 1;
  }
  if ((normalized.match(/\?/g) ?? []).length >= 2) {
    scores.surprised += 1;
  }

  scores.surprised += countMatches(normalized, SURPRISED_PATTERNS);
  scores.angry += countMatches(normalized, ANGRY_PATTERNS);
  scores.thinking += countMatches(normalized, THINKING_PATTERNS);
  scores.hurt += countMatches(normalized, HURT_PATTERNS) * 2;

  if (scores.angry > 0 && normalized.includes('!')) {
    scores.angry += 1;
  }
  if (scores.thinking > 0 && !normalized.includes('!')) {
    scores.stern += 1;
  }
  if (scores.surprised > 0 && scores.angry > 0) {
    scores.surprised += 1;
  }

  const strongest = (Object.entries(scores) as Array<[CodecExpression, number]>)
    .sort((left, right) => right[1] - left[1])
    .find(([, score]) => score > 0);

  return strongest?.[0] ?? fallback;
}

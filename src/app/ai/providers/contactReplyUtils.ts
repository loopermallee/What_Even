import { applyCharacterResponseCap, buildCharacterSystemPrompt, type CharacterContract } from '../characterContracts';
import type { Contact, TranscriptEntry } from '../../types';

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSpeakerPrefix(text: string, speaker: string) {
  const speakerPattern = new RegExp(`^${escapeRegExp(speaker)}\\s*:\\s*`, 'i');
  return text.replace(speakerPattern, '');
}

function asAbortError() {
  return new DOMException('The response job was aborted.', 'AbortError');
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(asAbortError());
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(asAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function buildHistoryContext(transcript: TranscriptEntry[], currentUserTurnId: number, responseJobId: number) {
  return transcript
    .filter((entry) => (
      entry.id !== currentUserTurnId
      && entry.responseJobId !== responseJobId
      && entry.role !== 'system'
      && entry.text.trim().length > 0
    ))
    .slice(-6)
    .map((entry) => `${entry.role === 'user' ? 'USER' : 'CONTACT'} ${entry.speaker}: ${entry.text}`)
    .join('\n');
}

export function buildContactInstruction(contact: Contact) {
  return buildCharacterSystemPrompt(contact);
}

export function buildContactUserPrompt(options: {
  transcript: TranscriptEntry[];
  currentUserTurnId: number;
  responseJobId: number;
  userText: string;
}) {
  const history = buildHistoryContext(options.transcript, options.currentUserTurnId, options.responseJobId);
  return [
    history ? `Recent radio exchange:\n${history}` : 'Recent radio exchange: none yet.',
    `Current user transmission:\n${options.userText.trim()}`,
    'Reply as the contact only.',
  ].join('\n\n');
}

export function normalizeContactReplyText(text: string, options: {
  speaker: string;
  signoff: string;
  contract: CharacterContract;
}) {
  let normalized = collapseWhitespace(text)
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '');

  normalized = stripSpeakerPrefix(normalized, options.speaker);
  if (options.signoff) {
    const signoffPattern = new RegExp(`\\s*${escapeRegExp(options.signoff)}\\s*$`, 'i');
    normalized = normalized.replace(signoffPattern, '');
  }

  normalized = collapseWhitespace(normalized);
  return applyCharacterResponseCap(normalized, options.contract);
}

export async function simulateProgressiveDelivery(
  finalText: string,
  emit: (text: string) => void,
  signal: AbortSignal,
  delayMs = 48,
) {
  const tokens = finalText.match(/\S+\s*/g) ?? [finalText];
  if (tokens.length <= 1) {
    emit(finalText);
    return;
  }

  let assembled = '';
  for (let index = 0; index < tokens.length; index += 2) {
    assembled += tokens.slice(index, index + 2).join('');
    emit(assembled.trimEnd());
    if (index + 2 < tokens.length) {
      await wait(delayMs, signal);
    }
  }
}

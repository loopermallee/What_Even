import type { TranscriptEntry } from '../../app/types';

export function renderTranscriptPanel(transcript: TranscriptEntry[], options?: { partialText?: string }) {
  const partial = options?.partialText?.trim() ?? '';
  const partialHtml = partial ? `<div class="transcript-line transcript-partial"><span class="transcript-speaker">USER (partial):</span> ${partial}</div>` : '';

  if (transcript.length === 0 && !partial) {
    return '<div class="transcript-empty">No transcript yet.</div>';
  }

  const committed = transcript
    .slice(-6)
    .map((entry) => `<div class="transcript-line transcript-role-${entry.role}"><span class="transcript-speaker">${entry.speaker}:</span> ${entry.text}</div>`)
    .join('');

  return `${partialHtml}${committed}`;
}

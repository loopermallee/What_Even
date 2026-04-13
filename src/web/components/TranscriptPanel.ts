import type { TranscriptEntry } from '../../app/types';

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function roleLabel(role: TranscriptEntry['role']) {
  if (role === 'user') {
    return 'USER';
  }

  if (role === 'contact') {
    return 'CONTACT';
  }

  return 'SYSTEM';
}

export function renderTranscriptPanel(transcript: TranscriptEntry[], options?: { partialText?: string }) {
  const partial = options?.partialText?.trim() ?? '';
  const partialHtml = partial
    ? `<div class="transcript-live-row"><span class="transcript-chip transcript-chip-live">LIVE</span><span class="transcript-speaker">YOU (partial)</span><span class="transcript-text">${escapeHtml(partial)}</span></div>`
    : '';

  if (transcript.length === 0 && !partial) {
    return '<div class="transcript-empty">No transcript yet.</div>';
  }

  const committed = transcript
    .slice(-6)
    .map((entry) => `
      <div class="transcript-line transcript-role-${entry.role}">
        <span class="transcript-chip transcript-chip-${entry.role}">${roleLabel(entry.role)}</span>
        <span class="transcript-speaker">${escapeHtml(entry.speaker)}</span>
        <span class="transcript-text">${escapeHtml(entry.text)}</span>
      </div>
    `)
    .join('');

  return `${partialHtml}<div class="transcript-committed">${committed}</div>`;
}

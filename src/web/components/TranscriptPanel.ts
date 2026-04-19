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

function getEntryChipLabel(entry: TranscriptEntry) {
  if (entry.streamState === 'placeholder' || entry.streamState === 'streaming') {
    return 'RECV';
  }

  return roleLabel(entry.role);
}

function getEntryChipClassName(entry: TranscriptEntry) {
  if (entry.streamState === 'placeholder' || entry.streamState === 'streaming') {
    return 'transcript-chip-live';
  }

  return `transcript-chip-${entry.role}`;
}

function getEntryText(entry: TranscriptEntry) {
  if (entry.text.trim()) {
    return entry.text;
  }

  if (entry.streamState === 'placeholder' || entry.streamState === 'streaming') {
    return 'Receiving...';
  }

  return '';
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
        <span class="transcript-chip ${getEntryChipClassName(entry)}">${getEntryChipLabel(entry)}</span>
        <span class="transcript-speaker">${escapeHtml(entry.speaker)}</span>
        <span class="transcript-text">${escapeHtml(getEntryText(entry))}</span>
      </div>
    `)
    .join('');

  return `${partialHtml}<div class="transcript-committed">${committed}</div>`;
}

import type { TranscriptEntry } from '../../app/types';

export function renderTranscriptPanel(transcript: TranscriptEntry[]) {
  if (transcript.length === 0) {
    return '<div class="transcript-empty">No transcript yet.</div>';
  }

  return transcript
    .slice(-6)
    .map((entry) => `<div class="transcript-line"><span class="transcript-speaker">${entry.speaker}:</span> ${entry.text}</div>`)
    .join('');
}

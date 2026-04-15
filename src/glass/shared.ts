import { CONTACTS } from '../app/contacts';
import type { AppState, TranscriptEntry } from '../app/types';

export type PortraitAsset = 'portrait-colonel' | 'portrait-meryl' | 'portrait-otacon' | 'portrait-snake';
export type GlassPresentationMode = 'compact' | 'read';
export type GlassLiveLineKind = 'none' | 'contact' | 'user';

export const GLASSES_CONTAINERS = {
  startupHeaderText: { id: 91, name: 'boot-head' },
  startupBodyText: { id: 92, name: 'boot-body' },
  portraitImage: { id: 101, name: 'codec-face' },
  dialogueText: { id: 102, name: 'codec-dialog' },
  statusList: { id: 103, name: 'codec-status' },
} as const;

export type GlassScreenView = {
  screenLabel: string;
  statusLabel: string;
  portraitAsset: PortraitAsset;
  dialogue: string;
  actions: string[];
  selectedActionIndex: number;
  mode: GlassPresentationMode;
  liveLineKind: GlassLiveLineKind;
};

const DEFAULT_CODEC_LINE_WIDTH = 27;

export function wrapTextLines(content: string, maxCharsPerLine: number) {
  const rows: string[] = [];

  for (const block of content.split('\n')) {
    const words = block.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      rows.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        line = next;
        continue;
      }

      if (line) {
        rows.push(line);
      }
      line = word;
    }

    if (line) {
      rows.push(line);
    }
  }

  return rows;
}

export function wrapText(content: string, maxCharsPerLine: number, maxLines: number) {
  return wrapTextLines(content, maxCharsPerLine).slice(0, maxLines).join('\n');
}

export function normalizeCodecText(text: string) {
  return text.trim().replace(/\s+/g, ' ');
}

export function fitCodecLine(text: string, maxChars = DEFAULT_CODEC_LINE_WIDTH) {
  const normalized = normalizeCodecText(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  if (maxChars <= 3) {
    return normalized.slice(0, maxChars);
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

export function formatCodecLine(label: string, text: string, maxChars = DEFAULT_CODEC_LINE_WIDTH) {
  const prefix = `${label}: `;
  const normalized = normalizeCodecText(text);
  const available = Math.max(0, maxChars - prefix.length);

  if (!normalized) {
    return fitCodecLine(prefix.trimEnd(), maxChars);
  }

  if (prefix.length + normalized.length <= maxChars) {
    return `${prefix}${normalized}`;
  }

  if (available <= 3) {
    return fitCodecLine(prefix.trimEnd(), maxChars);
  }

  return `${prefix}${normalized.slice(0, available - 3).trimEnd()}...`;
}

export function countWrappedLines(content: string, maxChars = DEFAULT_CODEC_LINE_WIDTH) {
  return wrapTextLines(content, maxChars).length;
}

export function withLiveCursor(text: string, cursorVisible: boolean) {
  if (!cursorVisible) {
    return text;
  }

  return `${text} |`;
}

function appendInlineCursorIfItFits(lines: string[], maxCharsPerLine: number, cursorVisible: boolean) {
  if (!cursorVisible || lines.length === 0) {
    return lines;
  }

  const nextLines = [...lines];
  const lastIndex = nextLines.length - 1;
  const lastLine = nextLines[lastIndex] ?? '';
  if (!lastLine || lastLine.length + 2 > maxCharsPerLine) {
    return nextLines;
  }

  nextLines[lastIndex] = `${lastLine} |`;
  return nextLines;
}

export function formatGlassSpeakerLine(options: {
  label: string;
  text: string;
  maxChars?: number;
  maxLines?: number;
  cursorVisible?: boolean;
}) {
  const maxChars = options.maxChars ?? DEFAULT_CODEC_LINE_WIDTH;
  const maxLines = options.maxLines ?? 3;
  const content = `${options.label}: ${normalizeCodecText(options.text)}`;
  const wrapped = wrapTextLines(content, maxChars).slice(0, maxLines);
  return appendInlineCursorIfItFits(wrapped, maxChars, Boolean(options.cursorVisible)).join('\n');
}

export function shouldUseReadMode(options: {
  label?: string;
  text: string;
  maxChars?: number;
  maxCompactLines?: number;
}) {
  const maxChars = options.maxChars ?? DEFAULT_CODEC_LINE_WIDTH;
  const maxCompactLines = options.maxCompactLines ?? 3;
  const labelPrefix = options.label ? `${options.label}: ` : '';
  const normalized = normalizeCodecText(options.text);
  const wrappedLines = countWrappedLines(`${labelPrefix}${normalized}`, maxChars);

  return normalized.length > maxChars || wrappedLines > maxCompactLines;
}

export function getSelectedContact(state: AppState) {
  return CONTACTS[state.selectedContactIndex] ?? CONTACTS[0];
}

export function getPortraitAssetForContactName(name: string): PortraitAsset {
  if (name === 'Colonel') {
    return 'portrait-colonel';
  }

  if (name === 'Meryl') {
    return 'portrait-meryl';
  }

  if (name === 'Otacon') {
    return 'portrait-otacon';
  }

  return 'portrait-snake';
}

export function getPortraitAssetForState(state: AppState): PortraitAsset {
  const contact = getSelectedContact(state);

  if (state.screen === 'active') {
    const activeEntry = getActiveTranscriptEntry(state);
    if (!activeEntry) {
      return getPortraitAssetForContactName(contact.name);
    }

    if (activeEntry.role === 'user' || activeEntry.role === 'system') {
      return 'portrait-snake';
    }
  }

  return getPortraitAssetForContactName(contact.name);
}

export function getCurrentSpeakerName(state: AppState) {
  const activeEntry = getActiveTranscriptEntry(state);
  if (activeEntry) {
    return activeEntry.speaker.toUpperCase();
  }

  const contact = getSelectedContact(state);
  return contact.name.toUpperCase();
}

export function getActiveTranscriptEntry(state: AppState): TranscriptEntry | null {
  if (state.transcript.length === 0) {
    return null;
  }

  if (state.activeTranscriptCursor < 0) {
    return null;
  }

  return state.transcript[state.activeTranscriptCursor] ?? null;
}

export function getLatestTranscriptEntryByRole(
  state: AppState,
  roles: TranscriptEntry['role'][]
): TranscriptEntry | null {
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const entry = state.transcript[index];
    if (!roles.includes(entry.role)) {
      continue;
    }

    if (!entry.text.trim()) {
      continue;
    }

    return entry;
  }

  return null;
}

export function getPreviousTranscriptEntry(state: AppState, index: number) {
  if (index <= 0 || index >= state.transcript.length) {
    return null;
  }

  return state.transcript[index - 1] ?? null;
}

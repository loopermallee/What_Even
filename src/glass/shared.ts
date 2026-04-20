import { getCurrentContact } from '../app/contacts';
import { resolveCodecPortraitState } from '../app/codecPortraitState';
import type { AppState, CodecCharacterId, SpeakerSide, TranscriptEntry } from '../app/types';

export type PortraitAssetBase = 'portrait-colonel' | 'portrait-meiling' | 'portrait-meryl' | 'portrait-otacon' | 'portrait-snake';
export type PortraitAsset =
  | PortraitAssetBase
  | 'portrait-colonel-alert'
  | 'portrait-meiling-alert'
  | 'portrait-meryl-alert'
  | 'portrait-otacon-alert'
  | 'portrait-snake-alert';
export type GlassPresentationMode = 'compact' | 'read';
export type GlassLiveLineKind = 'none' | 'contact' | 'user';
export type GlassPortraitExpressionBucket = 'default' | 'alert';

export const GLASSES_CONTAINERS = {
  startupHeaderText: { id: 91, name: 'boot-head' },
  startupBodyText: { id: 92, name: 'boot-body' },
  portraitImage: { id: 101, name: 'codec-left' },
  dialogueText: { id: 102, name: 'codec-dialog' },
  statusList: { id: 103, name: 'codec-status' },
  footerText: { id: 104, name: 'codec-footer' },
  centerImage: { id: 105, name: 'codec-core' },
  rightPortraitImage: { id: 106, name: 'codec-user' },
  topRowText: { id: 107, name: 'codec-top' },
  centerReadoutText: { id: 108, name: 'codec-read' },
} as const;

// Keep this tunable: perceived fit can differ a bit between the simulator and real G2 hardware.
export const CONTACTS_TEXT_WRAP_WIDTH = 44;

export const CONTACTS_LAYOUT = {
  // Keep the contacts frame comfortably inset so box-drawing glyphs do not clip on G2 edges.
  panel: {
    xPosition: 40,
    yPosition: 42,
    width: 496,
    height: 196,
  },
} as const;

export type GlassCenterModuleVariant = 'directory' | 'incoming' | 'listening' | 'active' | 'ended' | 'debug';
export type GlassActionMode = 'hidden-list' | 'tap-only' | 'none';
export type GlassCaptureSurfaceMode = 'list' | 'text' | 'none';

export type GlassScreenView = {
  screenLabel: string;
  statusLabel: string;
  dialogue: string;
  footerLabel?: string;
  topRowText: string;
  centerReadoutText: string;
  subtitleText: string;
  actions: string[];
  selectedActionIndex: number;
  mode: GlassPresentationMode;
  liveLineKind: GlassLiveLineKind;
  showPortrait: boolean;
  showActions: boolean;
  dialogueCapturesInput?: boolean;
  centerModuleVariant: GlassCenterModuleVariant;
  actionMode: GlassActionMode;
  captureSurfaceMode: GlassCaptureSurfaceMode;
};

export type GlassPortraitState = {
  leftPortraitAsset: PortraitAsset;
  rightPortraitAsset: PortraitAsset;
  leftPortraitBase: PortraitAssetBase;
  rightPortraitBase: PortraitAssetBase;
  leftExpressionBucket: GlassPortraitExpressionBucket;
  rightExpressionBucket: GlassPortraitExpressionBucket;
  speakerSide: SpeakerSide | null;
  isTalking: boolean;
  leftActive: boolean;
  rightActive: boolean;
  barBucket: number;
  stateLabel: string;
  speakerLabel: string;
  frequency: string;
  syncKey: string;
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

export function getRollingWrappedText(content: string, maxCharsPerLine: number, maxLines: number) {
  const lines = wrapTextLines(content, maxCharsPerLine);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

export function getWrappedWindow(options: {
  content: string;
  maxCharsPerLine: number;
  maxLines: number;
  offset: number;
}) {
  const lines = wrapTextLines(options.content, options.maxCharsPerLine);
  const maxOffset = Math.max(0, lines.length - options.maxLines);
  const offset = Math.max(0, Math.min(options.offset, maxOffset));
  return {
    text: lines.slice(offset, offset + options.maxLines).join('\n'),
    lineCount: lines.length,
    offset,
    maxOffset,
  };
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

export function shouldOfferReviewText(content: string, maxChars = DEFAULT_CODEC_LINE_WIDTH, maxCompactLines = 3) {
  return countWrappedLines(content, maxChars) > maxCompactLines;
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
  return getCurrentContact(state);
}

export function toSubtitleLines(content: string, maxCharsPerLine = 30, maxLines = 2) {
  return wrapTextLines(normalizeCodecText(content), maxCharsPerLine)
    .filter(Boolean)
    .slice(0, maxLines);
}

function getPortraitAssetForCharacterId(characterId: CodecCharacterId): PortraitAssetBase {
  if (characterId === 'colonel') {
    return 'portrait-colonel';
  }

  if (characterId === 'meiling') {
    return 'portrait-meiling';
  }

  if (characterId === 'meryl') {
    return 'portrait-meryl';
  }

  if (characterId === 'otacon') {
    return 'portrait-otacon';
  }

  return 'portrait-snake';
}

export function getPortraitAssetForContactName(name: string): PortraitAssetBase {
  if (name === 'Colonel') {
    return 'portrait-colonel';
  }

  if (name === 'Mei Ling') {
    return 'portrait-meiling';
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
  return resolveGlassPortraitState(state).leftPortraitAsset;
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

function toGlassExpressionBucket(family: ReturnType<typeof resolveCodecPortraitState>['left']['family']): GlassPortraitExpressionBucket {
  return family === 'alert' ? 'alert' : 'default';
}

function appendExpressionBucketToAsset(base: PortraitAssetBase, bucket: GlassPortraitExpressionBucket): PortraitAsset {
  if (bucket === 'default') {
    return base;
  }

  return `${base}-alert` as PortraitAsset;
}

function clampBarBucket(bucket: number) {
  return Math.max(0, Math.min(10, Math.round(bucket)));
}

export function resolveGlassPortraitState(state: AppState): GlassPortraitState {
  const scene = resolveCodecPortraitState(state);
  const contact = getSelectedContact(state);
  const leftPortraitBase = getPortraitAssetForCharacterId(contact.characterId);
  const rightPortraitBase = 'portrait-snake' as PortraitAssetBase;
  const leftExpressionBucket = toGlassExpressionBucket(scene.left.family);
  const rightExpressionBucket = toGlassExpressionBucket(scene.right.family);
  const leftPortraitAsset = appendExpressionBucketToAsset(leftPortraitBase, leftExpressionBucket);
  const rightPortraitAsset = appendExpressionBucketToAsset(rightPortraitBase, rightExpressionBucket);
  const isTalking = scene.talkingMode !== 'silent' && scene.currentRole !== 'system';
  const liveAudioBucket = clampBarBucket(3 + Math.round(scene.listeningActivityLevel * 5));
  const barBucket = scene.talkingMode === 'live_audio'
    ? liveAudioBucket
    : clampBarBucket(scene.signalBarBase + (isTalking ? 1 : 0));

  return {
    leftPortraitAsset,
    rightPortraitAsset,
    leftPortraitBase,
    rightPortraitBase,
    leftExpressionBucket,
    rightExpressionBucket,
    speakerSide: scene.activeSpeakerSide,
    isTalking,
    leftActive: scene.left.active,
    rightActive: scene.right.active,
    barBucket,
    stateLabel: scene.stateLabel,
    speakerLabel: scene.speakerLabel,
    frequency: contact.frequency,
    syncKey: `${leftPortraitAsset}:${rightPortraitAsset}:${scene.activeSpeakerSide ?? 'none'}:${barBucket}:${scene.stateLabel}`,
  };
}

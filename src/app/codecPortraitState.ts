import { CONTACTS, RIGHT_CHARACTER } from './contacts';
import { getCanonicalTurnLabel, getResponseStatusLabel, getVisibleSttDraft, shouldShowNoConfirmedSpeech } from './presentation';
import { resolveCodecExpression, resolveCodecPortraitFamily } from './portraitExpression';
import type {
  AppState,
  CodecCharacterId,
  CodecExpression,
  CodecPortraitFamily,
  CodecTalkingMode,
  ScriptedLineMetadata,
  SpeakerSide,
  TranscriptEntry,
} from './types';

export type CodecPortraitSideState = {
  side: SpeakerSide;
  label: string;
  tag: string;
  characterId?: CodecCharacterId;
  active: boolean;
  expression: CodecExpression;
  family: CodecPortraitFamily;
  role: TranscriptEntry['role'] | null;
  entryId: number | null;
};

export type CodecPortraitScene = {
  stateLabel: string;
  speakerLabel: string;
  currentLine: string;
  previousLine: string | null;
  activeSpeakerSide: SpeakerSide | null;
  talkingMode: CodecTalkingMode;
  currentEntryId: number | null;
  currentRole: TranscriptEntry['role'] | null;
  currentLineMetadata: ScriptedLineMetadata | null;
  signalBarBase: number;
  listeningActivityLevel: number;
  left: CodecPortraitSideState;
  right: CodecPortraitSideState;
};

function shortenLine(text: string, maxChars = 92) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function getPreviousEntryLine(state: AppState, currentIndex: number) {
  if (currentIndex <= 0 || currentIndex >= state.transcript.length) {
    return null;
  }

  const previous = state.transcript[currentIndex - 1];
  return previous ? shortenLine(`${previous.speaker.toUpperCase()}: ${previous.text}`, 76) : null;
}

function getLatestEntryByRole(state: AppState, roles: TranscriptEntry['role'][]) {
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const entry = state.transcript[index];
    if (!roles.includes(entry.role) || !entry.text.trim()) {
      continue;
    }

    return entry;
  }

  return null;
}

function getFocusedEntry(state: AppState) {
  if (state.activeTranscriptCursor < 0) {
    return null;
  }

  return state.transcript[state.activeTranscriptCursor] ?? null;
}

function getSignalBarBase(state: AppState) {
  if (state.screen === 'incoming') {
    return 8;
  }

  if (state.screen === 'ended') {
    return 2;
  }

  if (state.screen === 'active') {
    return 5;
  }

  if (state.screen === 'listening') {
    return 4;
  }

  return state.started ? 5 : 2;
}

function getEntrySide(entry: TranscriptEntry | null): SpeakerSide | null {
  if (!entry) {
    return null;
  }

  return entry.role === 'user' ? 'right' : 'left';
}

function buildSideState(options: {
  side: SpeakerSide;
  label: string;
  tag: string;
  characterId?: CodecCharacterId;
  active: boolean;
  expression: CodecExpression;
  family: CodecPortraitFamily;
  role: TranscriptEntry['role'] | null;
  entryId: number | null;
}): CodecPortraitSideState {
  return {
    side: options.side,
    label: options.label,
    tag: options.tag,
    characterId: options.characterId,
    active: options.active,
    expression: options.expression,
    family: options.family,
    role: options.role,
    entryId: options.entryId,
  };
}

export function resolveCodecPortraitState(state: AppState): CodecPortraitScene {
  const contact = CONTACTS[state.selectedContactIndex];
  const visibleDraft = getVisibleSttDraft(state);
  const latestUser = getLatestEntryByRole(state, ['user']);
  const latestContact = getLatestEntryByRole(state, ['contact', 'system']);
  const focusedEntry = getFocusedEntry(state);

  let stateLabel = state.started ? 'STAND BY' : 'SETUP';
  let speakerLabel = 'SYSTEM';
  let currentLine = state.started
    ? 'Select a contact and start the codec link.'
    : 'Start on Even to arm the mobile codec companion.';
  let previousLine: string | null = `${contact.name.toUpperCase()} TUNED ${contact.frequency}`;
  let activeSpeakerSide: SpeakerSide | null = null;
  let currentEntry: TranscriptEntry | null = null;
  let expressionSourceText = currentLine;
  let expressionSourceEmotion: CodecExpression | undefined;
  let expressionRole: TranscriptEntry['role'] | null = 'system';

  if (state.screen === 'incoming') {
    stateLabel = 'TRANSMIT';
    speakerLabel = contact.name.toUpperCase();
    currentLine = 'Secure transmission handshake. Link stabilizing.';
    previousLine = `FREQUENCY ${contact.frequency}`;
    activeSpeakerSide = 'left';
    expressionSourceText = currentLine;
    expressionRole = 'contact';
  } else if (state.screen === 'listening') {
    if (state.listeningMode === 'review') {
      stateLabel = 'REVIEW TEXT';
      speakerLabel = 'YOU';
      currentLine = latestUser?.text ?? 'No captured text yet.';
      previousLine = null;
      activeSpeakerSide = 'right';
      expressionSourceText = currentLine;
      expressionRole = 'user';
    } else if (state.listeningMode === 'actions' && latestUser) {
      stateLabel = 'READY';
      speakerLabel = 'YOU';
      currentLine = latestUser.text;
      previousLine = latestContact ? shortenLine(`${latestContact.speaker.toUpperCase()}: ${latestContact.text}`, 76) : null;
      activeSpeakerSide = 'right';
      expressionSourceText = currentLine;
      expressionRole = 'user';
    } else if (visibleDraft) {
      stateLabel = 'SPEAK';
      speakerLabel = 'YOU';
      currentLine = visibleDraft;
      previousLine = latestContact ? shortenLine(`${latestContact.speaker.toUpperCase()}: ${latestContact.text}`, 76) : null;
      activeSpeakerSide = 'right';
      expressionSourceText = visibleDraft;
      expressionRole = 'user';
    } else {
      stateLabel = 'SPEAK';
      speakerLabel = 'YOU';
      currentLine = shouldShowNoConfirmedSpeech(state)
        ? 'No confirmed speech yet. Speak again.'
        : 'Speak when ready.';
      previousLine = null;
      activeSpeakerSide = 'right';
      expressionSourceText = currentLine;
      expressionRole = 'user';
    }
  } else if (state.screen === 'active') {
    const current = focusedEntry ?? latestContact ?? latestUser;
    stateLabel = state.responseError
      ? 'STAND BY'
      : (state.responseStatusPhase
        ? getResponseStatusLabel(state.responseStatusPhase).toUpperCase()
        : getCanonicalTurnLabel(state.turnState).toUpperCase());
    speakerLabel = current?.speaker.toUpperCase() ?? contact.name.toUpperCase();
    currentLine = current?.text ?? 'Awaiting the next exchange.';
    previousLine = focusedEntry
      ? getPreviousEntryLine(state, state.activeTranscriptCursor)
      : latestContact && latestUser
        ? shortenLine(`${latestUser.speaker.toUpperCase()}: ${latestUser.text}`, 76)
        : null;
    activeSpeakerSide = getEntrySide(current);
    currentEntry = current;
    expressionSourceText = current?.text ?? currentLine;
    expressionSourceEmotion = current?.emotion;
    expressionRole = current?.role ?? null;
  } else if (state.screen === 'ended') {
    const latestLine = state.transcript.length > 0
      ? state.transcript[state.transcript.length - 1]
      : null;
    stateLabel = 'LINK CLOSED';
    speakerLabel = 'SYSTEM';
    currentLine = 'Transmission complete. Return or redial.';
    previousLine = latestLine ? shortenLine(`${latestLine.speaker.toUpperCase()}: ${latestLine.text}`, 76) : null;
    activeSpeakerSide = null;
    expressionSourceText = currentLine;
    expressionRole = 'system';
  }

  const talkingMode: CodecTalkingMode = state.speechWindow.isOpen
    ? (state.speechWindow.source === 'scripted_text' || state.speechWindow.source === 'live_audio'
      ? state.speechWindow.source
      : 'silent')
    : 'silent';
  const activeExpression = resolveCodecExpression({
    text: expressionSourceText,
    explicitEmotion: expressionSourceEmotion,
    role: expressionRole,
    fallback: activeSpeakerSide === 'right' ? 'stern' : 'idle',
  });
  const activeFamily = resolveCodecPortraitFamily(activeExpression);

  const left = buildSideState({
    side: 'left',
    label: contact.name.toUpperCase(),
    tag: contact.portraitTag,
    characterId: contact.characterId,
    active: activeSpeakerSide === 'left',
    expression: activeSpeakerSide === 'left' ? activeExpression : 'idle',
    family: activeSpeakerSide === 'left' ? activeFamily : 'neutral',
    role: activeSpeakerSide === 'left' ? expressionRole : null,
    entryId: activeSpeakerSide === 'left' ? currentEntry?.id ?? state.speechWindow.entryId : null,
  });

  const right = buildSideState({
    side: 'right',
    label: RIGHT_CHARACTER.name.toUpperCase(),
    tag: RIGHT_CHARACTER.portraitTag,
    characterId: RIGHT_CHARACTER.characterId,
    active: activeSpeakerSide === 'right',
    expression: activeSpeakerSide === 'right' ? activeExpression : 'stern',
    family: activeSpeakerSide === 'right' ? activeFamily : 'neutral',
    role: activeSpeakerSide === 'right' ? expressionRole : null,
    entryId: activeSpeakerSide === 'right' ? currentEntry?.id ?? state.speechWindow.entryId : null,
  });

  return {
    stateLabel,
    speakerLabel,
    currentLine,
    previousLine,
    activeSpeakerSide,
    talkingMode,
    currentEntryId: currentEntry?.id ?? state.speechWindow.entryId,
    currentRole: currentEntry?.role ?? state.speechWindow.role,
    currentLineMetadata: (currentEntry?.id !== undefined && currentEntry?.id !== null)
      ? (state.scriptedLineMetadataByEntryId[currentEntry.id] ?? null)
      : null,
    signalBarBase: getSignalBarBase(state),
    listeningActivityLevel: state.listeningActivityLevel,
    left,
    right,
  };
}

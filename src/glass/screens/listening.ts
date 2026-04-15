import type { AppState } from '../../app/types';
import {
  formatGlassSpeakerLine,
  getLatestTranscriptEntryByRole,
  getPortraitAssetForState,
  getSelectedContact,
  shouldUseReadMode,
  wrapText,
  type GlassScreenView,
} from '../shared';

function getListeningPresentation(state: AppState) {
  const partial = state.sttPartialTranscript.trim();
  const draftGraceActive = Boolean(
    !partial &&
    state.sttDraftDisplayText.trim() &&
    state.sttDraftVisibleUntil !== null &&
    Date.now() <= state.sttDraftVisibleUntil
  );
  const visibleDraft = partial || (draftGraceActive ? state.sttDraftDisplayText.trim() : '');
  if (visibleDraft) {
    return {
      statusLabel: 'SPEAK',
      speakerLabel: 'YOU',
      line: visibleDraft,
      liveLineKind: partial ? 'user' as const : 'none' as const,
      actions: ['SEND', 'RETRY'],
    };
  }

  const latestContact = getLatestTranscriptEntryByRole(state, ['contact', 'system']);
  if (latestContact) {
    return {
      statusLabel: 'LISTEN',
      speakerLabel: latestContact.speaker.toUpperCase(),
      line: latestContact.text,
      liveLineKind: 'none' as const,
      actions: ['REPLY', 'END'],
    };
  }

  return {
    statusLabel: 'YOUR TURN',
    speakerLabel: 'YOU',
    line: 'Speak when ready.',
    liveLineKind: 'none' as const,
    actions: ['REPLY', 'END'],
  };
}

export function buildListeningScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const presentation = getListeningPresentation(state);
  const mode = shouldUseReadMode({
    label: presentation.speakerLabel,
    text: presentation.line,
  })
    ? 'read'
    : 'compact';

  return {
    screenLabel: `${contact.name.toUpperCase()} ${contact.frequency}`,
    statusLabel: presentation.statusLabel,
    portraitAsset: getPortraitAssetForState(state),
    dialogue: mode === 'read'
      ? formatGlassSpeakerLine({
        label: presentation.speakerLabel,
        text: presentation.line,
        maxLines: 6,
        cursorVisible: presentation.liveLineKind !== 'none',
      })
      : wrapText(
        formatGlassSpeakerLine({
          label: presentation.speakerLabel,
          text: presentation.line,
          maxLines: 3,
          cursorVisible: presentation.liveLineKind !== 'none',
        }),
        27,
        3
      ),
    actions: presentation.actions,
    selectedActionIndex: state.listeningActionIndex,
    mode,
    liveLineKind: presentation.liveLineKind,
  };
}

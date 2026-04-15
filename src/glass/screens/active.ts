import type { AppState } from '../../app/types';
import {
  formatGlassSpeakerLine,
  getActiveTranscriptEntry,
  getLatestTranscriptEntryByRole,
  getPortraitAssetForState,
  getPreviousTranscriptEntry,
  getSelectedContact,
  shouldUseReadMode,
  wrapText,
  type GlassScreenView,
} from '../shared';

export function buildActiveScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const latestUserLine = getLatestTranscriptEntryByRole(state, ['user'])?.text ?? 'Awaiting reply.';
  const latestReplyLine = state.turnState === 'error'
    ? 'Link unstable.'
    : getLatestTranscriptEntryByRole(state, ['contact'])?.text
      ?? getLatestTranscriptEntryByRole(state, ['system'])?.text
      ?? 'Standing by.';
  const focusedEntry = getActiveTranscriptEntry(state);
  const previousEntry = focusedEntry ? getPreviousTranscriptEntry(state, state.activeTranscriptCursor) : null;
  const mode = shouldUseReadMode({
    label: focusedEntry?.speaker.toUpperCase() ?? contact.name.toUpperCase(),
    text: focusedEntry?.text ?? latestReplyLine,
  })
    ? 'read'
    : 'compact';

  return {
    screenLabel: `${contact.name.toUpperCase()} ${contact.frequency}`,
    statusLabel: 'STAND BY',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: mode === 'read'
      ? formatGlassSpeakerLine({
        label: focusedEntry?.speaker.toUpperCase() ?? contact.name.toUpperCase(),
        text: focusedEntry?.text ?? latestReplyLine,
        maxLines: 6,
      })
      : wrapText([
        formatGlassSpeakerLine({ label: 'YOU', text: latestUserLine, maxLines: 2 }),
        formatGlassSpeakerLine({ label: contact.name.toUpperCase(), text: latestReplyLine, maxLines: 2 }),
        previousEntry ? wrapText(`${previousEntry.speaker.toUpperCase()}: ${previousEntry.text}`, 27, 1) : '',
      ].filter(Boolean).join('\n'), 27, 4),
    actions: ['NEXT', 'END'],
    selectedActionIndex: state.activeActionIndex,
    mode,
    liveLineKind: 'none',
  };
}

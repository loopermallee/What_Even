import type { AppState } from '../../app/types';
import { getActiveTranscriptEntry, getCurrentSpeakerName, getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildActiveScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const line = getActiveTranscriptEntry(state);
  const speaker = getCurrentSpeakerName(state);
  const cursorLabel = state.transcript.length === 0 || state.activeTranscriptCursor < 0
    ? '0/0'
    : `${state.activeTranscriptCursor + 1}/${state.transcript.length}`;
  const turnLabel = state.turnState.replace('_', ' ').toUpperCase();

  return {
    screenLabel: 'ACTIVE',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText([
      speaker,
      line?.text ?? 'Link open. Awaiting committed user input.',
      `TURN ${turnLabel} ${cursorLabel}`,
      `FREQ ${contact.frequency}`,
    ].join('\n'), 27, 4),
    actions: ['Next', 'End'],
    selectedActionIndex: state.activeActionIndex,
  };
}

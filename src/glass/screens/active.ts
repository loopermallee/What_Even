import type { AppState } from '../../app/types';
import { getCanonicalTurnLabel } from '../../app/presentation';
import { getActiveTranscriptEntry, getCurrentSpeakerName, getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildActiveScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const line = getActiveTranscriptEntry(state);
  const speaker = getCurrentSpeakerName(state);
  const turnLabel = getCanonicalTurnLabel(state.turnState);
  const statusLine = state.turnState === 'error'
    ? 'Response issue'
    : turnLabel;

  return {
    screenLabel: 'ACTIVE',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText([
      `>> ${speaker}`,
      line?.text ?? 'Awaiting input',
      statusLine,
      `FREQ ${contact.frequency}`,
    ].join('\n'), 27, 4),
    actions: ['Next', 'End'],
    selectedActionIndex: state.activeActionIndex,
  };
}

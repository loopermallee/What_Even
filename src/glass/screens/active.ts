import type { AppState } from '../../app/types';
import { getCurrentSpeakerName, getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildActiveScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const line = state.dialogueIndex >= 0 ? contact.dialogue[state.dialogueIndex] : null;
  const speaker = getCurrentSpeakerName(state);

  return {
    screenLabel: 'ACTIVE',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText([
      speaker,
      line?.text ?? 'Link open. Awaiting dialogue.',
      `FREQ ${contact.frequency}`,
    ].join('\n'), 27, 4),
    actions: ['Next', 'End'],
    selectedActionIndex: state.activeActionIndex,
  };
}

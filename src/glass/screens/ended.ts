import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildEndedScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: 'ENDED',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText([
      'CONNECTION ENDED',
      `${contact.name.toUpperCase()} LINK CLOSED`,
      `FREQ ${contact.frequency}`,
    ].join('\n'), 27, 4),
    actions: ['Redial', 'Back'],
    selectedActionIndex: state.endedActionIndex,
  };
}

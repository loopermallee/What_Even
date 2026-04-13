import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: 'INCOMING',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText([
      'INCOMING CODEC',
      `${contact.name.toUpperCase()} LINK REQUEST`,
      `FREQ ${contact.frequency}`,
      'SECURE CHANNEL READY',
    ].join('\n'), 27, 4),
    actions: ['Answer', 'Ignore'],
    selectedActionIndex: state.incomingActionIndex,
  };
}

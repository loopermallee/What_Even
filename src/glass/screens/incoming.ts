import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: `${contact.name.toUpperCase()} ${contact.frequency}`,
    statusLabel: 'INCOMING CALL',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText(`${contact.name.toUpperCase()} requesting link.`, 27, 2),
    actions: ['ANSWER', 'IGNORE'],
    selectedActionIndex: state.incomingActionIndex,
    mode: 'compact',
    liveLineKind: 'none',
  };
}

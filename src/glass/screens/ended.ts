import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildEndedScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: `${contact.name.toUpperCase()} ${contact.frequency}`,
    statusLabel: 'CALL ENDED',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText('Link closed. Select your next action.', 27, 2),
    actions: ['REDIAL', 'BACK'],
    selectedActionIndex: state.endedActionIndex,
    mode: 'compact',
    liveLineKind: 'none',
  };
}

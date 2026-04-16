import type { AppState } from '../../app/types';
import { getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildEndedScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: contact.name.toUpperCase(),
    statusLabel: 'LINK CLOSED',
    portraitAsset: null,
    dialogue: wrapText('Transmission complete.\nChoose your next move.', 27, 3),
    actions: ['RETURN', 'REDIAL'],
    selectedActionIndex: state.endedActionIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: true,
  };
}

import type { AppState } from '../../app/types';
import { getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: `CALLING ${contact.name.toUpperCase()}`,
    statusLabel: 'SECURE LINK',
    portraitAsset: null,
    dialogue: wrapText('Secure channel handshake.\nLink stabilizing.', 27, 3),
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: false,
    dialogueCapturesInput: true,
  };
}

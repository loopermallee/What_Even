import type { AppState } from '../../app/types';
import { getSelectedContact, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: `Transmitting ${contact.name}...`,
    statusLabel: 'Securing transmission.',
    portraitAsset: null,
    dialogue: '',
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: false,
    dialogueCapturesInput: true,
  };
}

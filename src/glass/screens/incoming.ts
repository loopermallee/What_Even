import type { AppState } from '../../app/types';
import { getSelectedContact, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: `Calling ${contact.name}...`,
    statusLabel: 'Securing channel.',
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

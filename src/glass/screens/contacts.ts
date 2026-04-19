import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { CONTACTS_TEXT_WRAP_WIDTH, wrapText, type GlassScreenView } from '../shared';

export function buildContactsScreen(state: AppState): GlassScreenView {
  return {
    screenLabel: 'Codec Directory',
    statusLabel: '',
    portraitAsset: null,
    dialogue: wrapText('Tap: Transmit', CONTACTS_TEXT_WRAP_WIDTH, 1),
    actions: CONTACTS.map((item) => item.name),
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: true,
  };
}

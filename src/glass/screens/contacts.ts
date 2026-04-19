import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { type GlassScreenView } from '../shared';

function formatContactRows(selectedContactIndex: number) {
  return CONTACTS.map((item, index) => (
    index === selectedContactIndex ? `> ${item.name}` : `  ${item.name}`
  )).join('\n');
}

export function buildContactsScreen(state: AppState): GlassScreenView {
  return {
    screenLabel: 'Codec Directory',
    statusLabel: '',
    portraitAsset: null,
    dialogue: formatContactRows(state.selectedContactIndex),
    footerLabel: 'Tap: Transmit',
    actions: [],
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: false,
    dialogueCapturesInput: true,
  };
}

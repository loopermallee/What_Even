import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildContactsScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: 'MEMORY',
    statusLabel: contact.frequency,
    portraitAsset: null,
    dialogue: wrapText('Scroll memory.\nTap to call.', 27, 2),
    actions: CONTACTS.map((item) => item.name),
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: true,
  };
}

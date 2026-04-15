import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildContactsScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: 'CODEC DIRECTORY',
    statusLabel: `CHANNEL ${state.selectedContactIndex + 1}/${CONTACTS.length}`,
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText(`${contact.name.toUpperCase()} ${contact.frequency}`, 27, 2),
    actions: CONTACTS.map((item) => item.name),
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
  };
}

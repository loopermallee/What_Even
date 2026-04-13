import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildContactsScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);

  return {
    screenLabel: 'CONTACTS',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText([
      'CODEC DIRECTORY',
      `SELECT ${contact.name.toUpperCase()}`,
      `FREQ ${contact.frequency}`,
      `ENTRY ${state.selectedContactIndex + 1}/${CONTACTS.length}`,
    ].join('\n'), 27, 4),
    actions: CONTACTS.map((item) => item.name),
    selectedActionIndex: state.selectedContactIndex,
  };
}

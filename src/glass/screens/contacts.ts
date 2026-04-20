import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { toSubtitleLines, type GlassScreenView } from '../shared';

function formatContactActionLabels() {
  return CONTACTS.map((item) => item.name);
}

export function buildContactsScreen(state: AppState): GlassScreenView {
  const selectedContact = CONTACTS[state.selectedContactIndex] ?? CONTACTS[0];
  const subtitleText = toSubtitleLines(
    `${selectedContact.name.toUpperCase()} ${selectedContact.frequency}. Swipe to select. Tap to dial.`,
    30,
    2,
  ).join('\n');

  return {
    screenLabel: 'Codec Directory',
    statusLabel: 'DIRECTORY',
    dialogue: subtitleText,
    topRowText: `${selectedContact.name.toUpperCase()}  ${selectedContact.frequency}  DIRECTORY`,
    centerReadoutText: `FREQ ${selectedContact.frequency}`,
    subtitleText,
    actions: formatContactActionLabels(),
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: true,
    dialogueCapturesInput: false,
    centerModuleVariant: 'directory',
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
  };
}

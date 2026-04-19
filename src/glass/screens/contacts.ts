import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { type GlassScreenView } from '../shared';

const FRAME_INNER_WIDTH = 22;

function padFrameLine(content = '') {
  return content.padEnd(FRAME_INNER_WIDTH, ' ');
}

function formatContactRows(selectedContactIndex: number) {
  return CONTACTS.map((item, index) => (
    index === selectedContactIndex ? `> ${item.name}` : `  ${item.name}`
  ));
}

function buildContactsFrame(selectedContactIndex: number) {
  const rows = formatContactRows(selectedContactIndex);
  return [
    `╔ ${padFrameLine('CODEC DIRECTORY')} ╗`,
    `║ ${padFrameLine()} ║`,
    ...rows.map((row) => `║ ${padFrameLine(row)} ║`),
    `║ ${padFrameLine()} ║`,
    `╟${'─'.repeat(FRAME_INNER_WIDTH + 2)}╢`,
    `║ ${padFrameLine('Tap: Transmit')} ║`,
    `╚${'═'.repeat(FRAME_INNER_WIDTH + 2)}╝`,
  ].join('\n');
}

export function buildContactsScreen(state: AppState): GlassScreenView {
  return {
    screenLabel: 'Codec Directory',
    statusLabel: '',
    portraitAsset: null,
    dialogue: buildContactsFrame(state.selectedContactIndex),
    actions: [],
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: false,
    dialogueCapturesInput: true,
  };
}

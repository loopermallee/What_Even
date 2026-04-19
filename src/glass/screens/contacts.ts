import { CONTACTS } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { type GlassScreenView } from '../shared';

const FRAME_CONTENT_WIDTH = 22;
const FRAME_RULE_WIDTH = FRAME_CONTENT_WIDTH + 2;

function padFrameLine(content = '') {
  return content.padEnd(FRAME_CONTENT_WIDTH, ' ');
}

function centerFrameLine(content: string) {
  const trimmed = content.trim();
  const totalPadding = Math.max(0, FRAME_CONTENT_WIDTH - trimmed.length);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${trimmed}${' '.repeat(rightPadding)}`;
}

function buildFrameRow(content = '') {
  return `║ ${padFrameLine(content)} ║`;
}

function buildFrameRule() {
  return `║${'─'.repeat(FRAME_RULE_WIDTH)}║`;
}

function buildContactsFrame() {
  return [
    `╔${'═'.repeat(FRAME_RULE_WIDTH)}╗`,
    buildFrameRow(centerFrameLine('CODEC DIRECTORY')),
    buildFrameRule(),
    ...Array.from({ length: CONTACTS.length }, () => buildFrameRow('')),
    buildFrameRule(),
    buildFrameRow('Tap: Transmit'),
    `╚${'═'.repeat(FRAME_RULE_WIDTH)}╝`,
  ].join('\n');
}

function formatContactActionLabels() {
  return CONTACTS.map((item) => item.name);
}

export function buildContactsScreen(state: AppState): GlassScreenView {
  return {
    screenLabel: 'Codec Directory',
    statusLabel: '',
    portraitAsset: null,
    dialogue: buildContactsFrame(),
    actions: formatContactActionLabels(),
    selectedActionIndex: state.selectedContactIndex,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: true,
    dialogueCapturesInput: false,
  };
}

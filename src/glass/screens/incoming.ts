import type { AppState } from '../../app/types';
import { getSelectedContact, toSubtitleLines, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const subtitleText = toSubtitleLines('Secure transmission handshake. Link stabilizing.', 30, 2).join('\n');

  return {
    screenLabel: `Transmitting ${contact.name}...`,
    statusLabel: 'Securing transmission.',
    dialogue: subtitleText,
    topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  TRANSMIT`,
    centerReadoutText: `FREQ ${contact.frequency}`,
    subtitleText,
    centerTopLabelText: 'PTT',
    centerBottomLabelText: 'MEMORY',
    horizontalActionsText: ' ',
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: false,
    dialogueCapturesInput: true,
    centerModuleVariant: 'incoming',
    actionMode: 'tap-only',
    captureSurfaceMode: 'text',
    arrowPulseDirection: 'none',
  };
}

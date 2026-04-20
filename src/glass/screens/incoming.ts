import type { AppState } from '../../app/types';
import { getSelectedContact, toSubtitleLines, type GlassScreenView } from '../shared';

export function buildIncomingScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const subtitleLines = toSubtitleLines('Secure transmission handshake. Link stabilizing.', 30, 2);

  return {
    screenLabel: `Transmitting ${contact.name}...`,
    statusLabel: 'Securing transmission.',
    dialogue: subtitleLines.join('\n'),
    actions: [],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: false,
    dialogueCapturesInput: true,
    centerModuleVariant: 'incoming',
    subtitleLines,
    actionMode: 'tap-only',
    captureSurfaceMode: 'text',
  };
}

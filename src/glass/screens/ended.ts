import type { AppState } from '../../app/types';
import { toSubtitleLines, wrapText, type GlassScreenView } from '../shared';

export function buildEndedScreen(_state: AppState): GlassScreenView {
  const subtitleText = toSubtitleLines('Transmission complete. Tap return to directory.', 30, 2).join('\n');

  return {
    screenLabel: '',
    statusLabel: '',
    dialogue: wrapText('Transmission ended.', 27, 1),
    topRowText: 'SYSTEM  CODEC  LINK CLOSED',
    centerReadoutText: 'SESSION ENDED',
    subtitleText,
    actions: ['RETURN'],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: true,
    centerModuleVariant: 'ended',
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
  };
}

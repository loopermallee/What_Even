import type { AppState } from '../../app/types';
import { toSubtitleLines, wrapText, type GlassScreenView } from '../shared';

export function buildEndedScreen(_state: AppState): GlassScreenView {
  const subtitleLines = toSubtitleLines('Transmission complete. Tap return to directory.', 30, 2);

  return {
    screenLabel: '',
    statusLabel: '',
    dialogue: wrapText('Transmission ended.', 27, 1),
    actions: ['RETURN'],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: true,
    centerModuleVariant: 'ended',
    subtitleLines,
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
  };
}

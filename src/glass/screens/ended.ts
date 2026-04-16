import type { AppState } from '../../app/types';
import { wrapText, type GlassScreenView } from '../shared';

export function buildEndedScreen(_state: AppState): GlassScreenView {
  return {
    screenLabel: '',
    statusLabel: '',
    portraitAsset: null,
    dialogue: wrapText('Transmission ended.', 27, 1),
    actions: ['RETURN'],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: false,
    showActions: true,
  };
}

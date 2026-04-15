import type { AppState } from '../../app/types';
import { wrapText, type GlassScreenView } from '../shared';

export function buildDebugScreen(state: AppState): GlassScreenView {
  const raw = state.lastRawEvent;

  return {
    screenLabel: 'DEBUG',
    statusLabel: 'DEV ONLY',
    portraitAsset: 'portrait-snake',
    dialogue: wrapText([
      `SCREEN ${state.screenBeforeDebug.toUpperCase()}`,
      `INPUT ${state.lastNormalizedInput ?? 'NONE'}`,
      `RAW ${(raw?.rawEventTypeName ?? 'NONE').slice(0, 18)}`,
      `LIFE ${state.deviceLifecycleState.toUpperCase()}`,
    ].join('\n'), 27, 4),
    actions: ['Exit Debug'],
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
  };
}

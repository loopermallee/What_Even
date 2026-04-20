import type { AppState } from '../../app/types';
import { toSubtitleLines, wrapText, type GlassScreenView } from '../shared';

export function buildDebugScreen(state: AppState): GlassScreenView {
  const raw = state.lastRawEvent;
  const subtitleLines = toSubtitleLines(
    `Input ${state.lastNormalizedInput ?? 'none'}. Raw ${(raw?.rawEventTypeName ?? 'none').slice(0, 24)}.`,
    30,
    2,
  );

  return {
    screenLabel: 'DEBUG',
    statusLabel: 'DEV ONLY',
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
    showPortrait: true,
    showActions: true,
    centerModuleVariant: 'debug',
    subtitleLines,
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
  };
}

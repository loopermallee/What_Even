import type { AppState } from '../../app/types';
import { formatHorizontalActions, toSubtitleLines, wrapText, type GlassScreenView } from '../shared';

export function buildDebugScreen(state: AppState): GlassScreenView {
  const actions = ['Exit Debug'];
  const raw = state.lastRawEvent;
  const subtitleText = toSubtitleLines(
    `Input ${state.lastNormalizedInput ?? 'none'}. Raw ${(raw?.rawEventTypeName ?? 'none').slice(0, 24)}.`,
    30,
    2,
  ).join('\n');

  return {
    screenLabel: 'DEBUG',
    statusLabel: 'DEV ONLY',
    dialogue: wrapText([
      `SCREEN ${state.screenBeforeDebug.toUpperCase()}`,
      `INPUT ${state.lastNormalizedInput ?? 'NONE'}`,
      `RAW ${(raw?.rawEventTypeName ?? 'NONE').slice(0, 18)}`,
      `LIFE ${state.deviceLifecycleState.toUpperCase()}`,
    ].join('\n'), 27, 4),
    topRowText: ' ',
    centerReadoutText: `SCREEN ${state.screenBeforeDebug.toUpperCase()}`,
    subtitleText,
    centerTopLabelText: 'PTT',
    centerBottomLabelText: 'MEMORY',
    horizontalActionsText: formatHorizontalActions(actions, 0),
    actions,
    selectedActionIndex: 0,
    mode: 'compact',
    liveLineKind: 'none',
    showPortrait: true,
    showActions: true,
    centerModuleVariant: 'debug',
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
    arrowPulseDirection: 'none',
  };
}

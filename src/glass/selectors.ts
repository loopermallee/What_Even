import type { AppState } from '../app/types';
import { buildActiveScreen } from './screens/active';
import { buildContactsScreen } from './screens/contacts';
import { buildDebugScreen } from './screens/debug';
import { buildEndedScreen } from './screens/ended';
import { buildIncomingScreen } from './screens/incoming';
import { buildListeningScreen } from './screens/listening';
import { resolveGlassPortraitState, type GlassPortraitState, type GlassScreenView } from './shared';

export function selectGlassScreenView(state: AppState): GlassScreenView {
  if (state.screen === 'contacts') {
    return buildContactsScreen(state);
  }

  if (state.screen === 'incoming') {
    return buildIncomingScreen(state);
  }

  if (state.screen === 'active') {
    return buildActiveScreen(state);
  }

  if (state.screen === 'ended') {
    return buildEndedScreen(state);
  }

  if (state.screen === 'debug') {
    return buildDebugScreen(state);
  }

  return buildListeningScreen(state);
}

export function selectDialogueForGlasses(state: AppState, cursorVisible = false) {
  const view = selectGlassScreenView(state);
  const dialogue = cursorVisible && view.liveLineKind !== 'none'
    ? view.dialogue
    : view.dialogue.replace(/ \|$/gm, '');

  return [view.screenLabel, view.statusLabel, dialogue].filter(Boolean).join('\n');
}

export function selectActionItemsForGlasses(state: AppState) {
  return selectGlassScreenView(state).actions;
}

export function selectGlassPortraitState(state: AppState): GlassPortraitState {
  return resolveGlassPortraitState(state);
}

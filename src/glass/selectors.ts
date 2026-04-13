import type { AppState } from '../app/types';
import { buildActiveScreen } from './screens/active';
import { buildContactsScreen } from './screens/contacts';
import { buildDebugScreen } from './screens/debug';
import { buildEndedScreen } from './screens/ended';
import { buildIncomingScreen } from './screens/incoming';
import { buildListeningScreen } from './screens/listening';
import type { GlassScreenView } from './shared';

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

export function selectDialogueForGlasses(state: AppState) {
  const view = selectGlassScreenView(state);
  return `${view.screenLabel}\n${view.dialogue}`;
}

export function selectActionItemsForGlasses(state: AppState) {
  return selectGlassScreenView(state).actions;
}

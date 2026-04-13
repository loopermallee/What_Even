import type { AppState } from '../../app/types';
import { getPortraitAssetForState, wrapText, type GlassScreenView } from '../shared';

export function buildListeningScreenScaffold(state: AppState): GlassScreenView {
  return {
    screenLabel: 'LISTENING',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText(
      'LISTENING STATE RESERVED FOR PHASE 2 STT/AUDIO TURN-TAKING FLOW.',
      27,
      4
    ),
    actions: ['Unavailable'],
    selectedActionIndex: 0,
  };
}

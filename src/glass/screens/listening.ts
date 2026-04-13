import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildListeningScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const micLabel = state.micOpen ? 'MIC OPEN' : 'MIC CLOSED';
  const frameAgeMs = state.lastAudioFrameAt === null ? null : Math.max(0, Date.now() - state.lastAudioFrameAt);
  const freshness = frameAgeMs === null ? 'NO FRAMES' : frameAgeMs <= 1000 ? 'LIVE' : `STALE ${Math.round(frameAgeMs / 100) * 100}MS`;
  const activity = Math.round(state.listeningActivityLevel * 100);

  return {
    screenLabel: 'LISTENING',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText(
      [
        `${contact.name.toUpperCase()} ${contact.frequency}`,
        `${micLabel} ${state.audioCaptureStatus.toUpperCase()}`,
        `BUF ${state.bufferedAudioDurationMs}MS ${state.audioBufferByteLength}B`,
        `ACT ${activity}% ${freshness}`,
      ].join('\n'),
      27,
      4
    ),
    actions: ['Continue', 'End'],
    selectedActionIndex: state.listeningActionIndex,
  };
}

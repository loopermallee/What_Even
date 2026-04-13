import type { AppState } from '../../app/types';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildListeningScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const sttStatus = state.sttStatus.toUpperCase();
  const partial = state.sttPartialTranscript.trim() || '...';
  const latestCommitted = [...state.transcript].reverse().find((entry) => entry.text.trim().length > 0)?.text ?? '';
  const frameAgeMs = state.lastAudioFrameAt === null ? null : Math.max(0, Date.now() - state.lastAudioFrameAt);
  const freshness = frameAgeMs === null ? 'NOFR' : frameAgeMs <= 1000 ? 'LIVE' : 'STLE';
  const activity = Math.round(state.listeningActivityLevel * 100);
  const lastLine = latestCommitted
    ? `LAST ${latestCommitted}`
    : `AUD ${activity}% ${freshness} ${state.audioCaptureStatus.toUpperCase()}`;
  const statusLine = state.sttError ? `STT ${sttStatus} ERR` : `STT ${sttStatus} MIC ${state.micOpen ? 'ON' : 'OFF'}`;

  return {
    screenLabel: 'LISTENING',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText(
      [
        `${contact.name.toUpperCase()} ${contact.frequency}`,
        statusLine,
        `HEAR ${partial}`,
        lastLine,
      ].join('\n'),
      27,
      4
    ),
    actions: ['Continue', 'End'],
    selectedActionIndex: state.listeningActionIndex,
  };
}

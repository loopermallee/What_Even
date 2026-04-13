import type { AppState } from '../../app/types';
import { getCanonicalTurnLabel, shouldShowNoConfirmedSpeech } from '../../app/presentation';
import { getPortraitAssetForState, getSelectedContact, wrapText, type GlassScreenView } from '../shared';

export function buildListeningScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const canonicalLabel = getCanonicalTurnLabel(state.turnState);
  const partial = state.sttPartialTranscript.trim();
  const latestCommitted = [...state.transcript].reverse().find((entry) => entry.text.trim().length > 0)?.text ?? '';
  const noConfirmedSpeech = shouldShowNoConfirmedSpeech(state);
  const frameAgeMs = state.lastAudioFrameAt === null ? null : Math.max(0, Date.now() - state.lastAudioFrameAt);
  const freshness = frameAgeMs === null ? 'NOFR' : frameAgeMs <= 1000 ? 'LIVE' : 'STLE';
  const activity = Math.round(state.listeningActivityLevel * 100);
  const listeningLabel = state.sttStatus === 'streaming' || state.micOpen ? 'Listening' : canonicalLabel;
  const statusLine = state.sttError
    ? 'STT issue'
    : `${listeningLabel} MIC ${state.micOpen ? 'ON' : 'OFF'}`;
  const hearLine = partial
    ? `PARTIAL ${partial}`
    : noConfirmedSpeech
      ? 'No confirmed speech'
      : 'PARTIAL ...';
  const lastLine = state.sttError
    ? `ERR ${state.sttStatus.toUpperCase()}`
    : latestCommitted
      ? `LAST ${latestCommitted}`
      : `AUD ${activity}% ${freshness} ${state.audioCaptureStatus.toUpperCase()}`;

  return {
    screenLabel: 'LISTENING',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: wrapText(
      [
        `${contact.name.toUpperCase()} ${contact.frequency}`,
        statusLine,
        hearLine,
        lastLine,
      ].join('\n'),
      27,
      4
    ),
    actions: ['Continue', 'End'],
    selectedActionIndex: state.listeningActionIndex,
  };
}

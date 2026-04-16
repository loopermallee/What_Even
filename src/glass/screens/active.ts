import type { AppState } from '../../app/types';
import {
  formatGlassSpeakerLine,
  getActiveTranscriptEntry,
  getPortraitAssetForState,
  getSelectedContact,
  shouldUseReadMode,
  wrapText,
  type GlassScreenView,
} from '../shared';

export function buildActiveScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const focusedEntry = getActiveTranscriptEntry(state);
  const speakerLabel = focusedEntry?.speaker.toUpperCase() ?? contact.name.toUpperCase();
  const line = focusedEntry?.text ?? 'Standing by.';
  const mode = shouldUseReadMode({
    label: speakerLabel,
    text: line,
  })
    ? 'read'
    : 'compact';

  return {
    screenLabel: contact.name.toUpperCase(),
    statusLabel: state.lastHandledUserTranscriptId === null ? 'LINK ESTABLISHED' : 'ACKNOWLEDGED',
    portraitAsset: getPortraitAssetForState(state),
    dialogue: mode === 'read'
      ? formatGlassSpeakerLine({
        label: speakerLabel,
        text: line,
        maxLines: 6,
      })
      : wrapText(formatGlassSpeakerLine({ label: speakerLabel, text: line, maxLines: 4 }), 27, 4),
    actions: ['NEXT'],
    selectedActionIndex: state.activeActionIndex,
    mode,
    liveLineKind: 'none',
    showPortrait: true,
    showActions: true,
  };
}

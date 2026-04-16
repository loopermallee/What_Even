import type { AppState } from '../../app/types';
import {
  formatGlassSpeakerLine,
  getActiveTranscriptEntry,
  getSelectedContact,
  shouldUseReadMode,
  wrapText,
  type GlassScreenView,
} from '../shared';

export function buildActiveScreen(state: AppState): GlassScreenView {
  const contact = getSelectedContact(state);
  const focusedEntry = getActiveTranscriptEntry(state);
  const speakerLabel = focusedEntry?.role === 'user'
    ? 'You'
    : contact.name;
  const line = focusedEntry?.text ?? 'Standing by.';
  const mode = shouldUseReadMode({
    label: speakerLabel,
    text: line,
  })
    ? 'read'
    : 'compact';

  return {
    screenLabel: '',
    statusLabel: '',
    portraitAsset: null,
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
    showPortrait: false,
    showActions: true,
  };
}

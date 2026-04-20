import type { AppState } from '../../app/types';
import { getResponseStatusLabel } from '../../app/presentation';
import {
  formatGlassSpeakerLine,
  getActiveTranscriptEntry,
  getSelectedContact,
  toSubtitleLines,
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
  const subtitleLines = toSubtitleLines(`${speakerLabel}: ${line}`, 30, 2);

  return {
    screenLabel: '',
    statusLabel: getResponseStatusLabel(state.responseStatusPhase).toUpperCase(),
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
    centerModuleVariant: 'active',
    subtitleLines,
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
  };
}

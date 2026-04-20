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
  const statusLabel = getResponseStatusLabel(state.responseStatusPhase).toUpperCase();
  const mode = shouldUseReadMode({
    label: speakerLabel,
    text: line,
  })
    ? 'read'
    : 'compact';
  const subtitleText = toSubtitleLines(`${speakerLabel}: ${line}`, 30, 2).join('\n');

  return {
    screenLabel: '',
    statusLabel,
    dialogue: mode === 'read'
      ? formatGlassSpeakerLine({
        label: speakerLabel,
        text: line,
        maxLines: 6,
      })
      : wrapText(formatGlassSpeakerLine({ label: speakerLabel, text: line, maxLines: 4 }), 27, 4),
    topRowText: `${contact.name.toUpperCase()}  ${contact.frequency}  ${statusLabel}`,
    centerReadoutText: `FREQ ${contact.frequency}`,
    subtitleText,
    actions: ['NEXT'],
    selectedActionIndex: state.activeActionIndex,
    mode,
    liveLineKind: 'none',
    showPortrait: true,
    showActions: true,
    centerModuleVariant: 'active',
    actionMode: 'hidden-list',
    captureSurfaceMode: 'list',
  };
}

import { RIGHT_CHARACTER } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { renderCodecPortrait } from './CodecPortrait';
import { renderSignalBars } from './SignalBars';
import { renderTranscriptPanel } from './TranscriptPanel';

export function renderCodecShell(state: AppState, options: {
  leftLabel: string;
  leftTag: string;
  rightActive: boolean;
  leftActive: boolean;
  mouthOpen: boolean;
  frequency: string;
  speakerLabel: string;
  dialogueText: string;
  barLevel: number;
}) {
  const barsHtml = renderSignalBars(options.barLevel);

  return `
    <div class="codec-shell">
      <div class="scanlines"></div>

      <div class="codec-top">
        ${renderCodecPortrait({
    label: options.leftLabel,
    tag: options.leftTag,
    active: options.leftActive,
    mouthOpen: options.leftActive && options.mouthOpen,
  })}

        <div class="codec-center">
          <div class="codec-tag top">PTT</div>

          <div class="signal-screen">
            <div class="signal-bars">${barsHtml}</div>
            <div class="frequency">${options.frequency}</div>
          </div>

          <div class="codec-tag bottom">MEMORY</div>
        </div>

        ${renderCodecPortrait({
    label: RIGHT_CHARACTER.name.toUpperCase(),
    tag: RIGHT_CHARACTER.portraitTag,
    active: options.rightActive,
    mouthOpen: options.rightActive && options.mouthOpen,
  })}
      </div>

      <div class="dialogue-box">
        <div class="speaker-name">${options.speakerLabel}</div>
        <div class="dialogue-text">${options.dialogueText}</div>
      </div>

      <div class="transcript-panel">
        ${renderTranscriptPanel(state.transcript, { partialText: state.sttPartialTranscript })}
      </div>
    </div>
  `;
}

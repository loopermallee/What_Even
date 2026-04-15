import { RIGHT_CHARACTER } from '../../app/contacts';
import type { AppState } from '../../app/types';
import { renderCodecPortrait } from './CodecPortrait';
import { renderSignalBars } from './SignalBars';
import { renderTranscriptPanel } from './TranscriptPanel';

export function renderCodecShell(state: AppState, options: {
  leftLabel: string;
  leftTag: string;
  leftCharacterId?: 'snake' | 'otacon' | 'meryl' | 'colonel';
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
    <div class="codec-shell ${options.mouthOpen ? 'codec-machine-speaking' : 'codec-machine-idle'}">
      <div class="codec-transmission-layers" aria-hidden="true">
        <div class="codec-noise-layer"></div>
        <div class="codec-crt-layer"></div>
        <div class="scanlines"></div>
        <div class="codec-glitch-layer"></div>
      </div>

      <div class="codec-machine-top">
        ${renderCodecPortrait({
    label: options.leftLabel,
    tag: options.leftTag,
    characterId: options.leftCharacterId,
    active: options.leftActive,
    expression: options.leftActive ? 'stern' : 'idle',
    blink: 'open',
    mouth: options.leftActive && options.mouthOpen ? 'half' : 'closed',
  })}

        <div class="codec-center-core">
          <div class="codec-center-cap">PTT</div>

          <div class="signal-screen">
            <div class="signal-screen-grid">
              <div class="signal-bars">${barsHtml}</div>
              <div class="frequency-stack">
                <span class="signal-label">TUNE</span>
                <strong>${options.frequency}</strong>
              </div>
            </div>
          </div>

          <div class="codec-center-cap bottom">MEMORY</div>
        </div>

        ${renderCodecPortrait({
    label: RIGHT_CHARACTER.name.toUpperCase(),
    tag: RIGHT_CHARACTER.portraitTag,
    characterId: RIGHT_CHARACTER.characterId,
    active: options.rightActive,
    expression: options.rightActive ? 'stern' : 'idle',
    blink: 'open',
    mouth: options.rightActive && options.mouthOpen ? 'half' : 'closed',
  })}
      </div>

      <div class="codec-dialogue-deck">
        <div class="codec-dialogue-speaker-row">
          <div class="dialogue-speaker">${options.speakerLabel}</div>
        </div>
        <div class="dialogue-current-line">${options.dialogueText}</div>
      </div>

      <div class="transcript-history codec-transcript-history">
        ${renderTranscriptPanel(state.transcript, { partialText: state.sttPartialTranscript })}
      </div>
    </div>
  `;
}

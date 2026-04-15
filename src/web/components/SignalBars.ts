import { CODEC_SIGNAL_FX_TUNING } from '../lib/codecPortraitFx';

export function renderSignalBars(level: number) {
  return Array.from({ length: 10 }, (_, index) => {
    const active = index < level;
    const intensity = active ? (index < 4 ? 'low' : index < 7 ? 'mid' : 'high') : 'off';
    return `<div class="signal-bar ${active ? 'active' : ''} signal-bar-${intensity}" style="height:${20 + index * 9}px;--signal-bar-phase:${index % 5};--signal-idle-duration:${CODEC_SIGNAL_FX_TUNING.idleDriftDurationMs}ms;--signal-idle-amplitude:${CODEC_SIGNAL_FX_TUNING.idleDriftAmplitudePx}px;--signal-speaking-duration:${CODEC_SIGNAL_FX_TUNING.speakingDriftDurationMs}ms;--signal-speaking-amplitude:${CODEC_SIGNAL_FX_TUNING.speakingDriftAmplitudePx}px"></div>`;
  }).join('');
}

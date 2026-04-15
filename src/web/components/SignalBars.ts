import { CODEC_SIGNAL_FX_TUNING } from '../lib/codecPortraitFx';
function clampBarBucket(level: number) {
  return Math.max(0, Math.min(10, Math.round(level)));
}

export function renderSignalBars(level: number) {
  const bucket = clampBarBucket(level);
  return Array.from({ length: 10 }, (_, index) => {
    const active = index < bucket;
    const intensity = active ? (index < 4 ? 'low' : index < 7 ? 'mid' : 'high') : 'off';
    return `<div class="signal-bar ${active ? 'active' : ''} signal-bar-${intensity}" data-signal-step="${index}" style="height:${20 + index * 9}px;--signal-bar-phase:${index % 5};--signal-idle-duration:${CODEC_SIGNAL_FX_TUNING.idleDriftDurationMs}ms;--signal-idle-amplitude:${CODEC_SIGNAL_FX_TUNING.idleDriftAmplitudePx}px;--signal-speaking-duration:${CODEC_SIGNAL_FX_TUNING.speakingDriftDurationMs}ms;--signal-speaking-amplitude:${CODEC_SIGNAL_FX_TUNING.speakingDriftAmplitudePx}px"></div>`;
  }).join('');
}

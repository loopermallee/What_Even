export const CODEC_PORTRAIT_FX_TUNING = {
  scanlineOpacity: 0.18,
  scanlineSpacingPx: 3,
  staticOpacityIdle: 0.12,
  staticOpacitySpeaking: 0.22,
  staticOpacityTransition: 0.44,
  staticBandOpacityIdle: 0.16,
  staticBandOpacitySpeaking: 0.28,
  staticBandOpacityTransition: 0.48,
  staticBandSpeedIdleMs: 4400,
  staticBandSpeedSpeakingMs: 2600,
  staticBandSpeedTransitionMs: 880,
  transitionBurstDurationMs: 190,
  transitionBurstIntensity: 0.82,
  brightness: 1.03,
  contrast: 1.14,
  posterizeBoost: 1.07,
  monochromeTintStrength: 0.88,
  jitterFrequencySpeakingMs: 680,
  jitterMagnitudePx: 1.2,
  glowIntensity: 0.34,
  interferenceSweepOpacity: 0.24,
} as const;

export function toPortraitCssVars() {
  const tuning = CODEC_PORTRAIT_FX_TUNING;
  return [
    `--portrait-scanline-opacity:${tuning.scanlineOpacity}`,
    `--portrait-scanline-spacing:${tuning.scanlineSpacingPx}px`,
    `--portrait-static-opacity-idle:${tuning.staticOpacityIdle}`,
    `--portrait-static-opacity-speaking:${tuning.staticOpacitySpeaking}`,
    `--portrait-static-opacity-transition:${tuning.staticOpacityTransition}`,
    `--portrait-static-band-opacity-idle:${tuning.staticBandOpacityIdle}`,
    `--portrait-static-band-opacity-speaking:${tuning.staticBandOpacitySpeaking}`,
    `--portrait-static-band-opacity-transition:${tuning.staticBandOpacityTransition}`,
    `--portrait-static-band-speed-idle:${tuning.staticBandSpeedIdleMs}ms`,
    `--portrait-static-band-speed-speaking:${tuning.staticBandSpeedSpeakingMs}ms`,
    `--portrait-static-band-speed-transition:${tuning.staticBandSpeedTransitionMs}ms`,
    `--portrait-transition-burst-duration:${tuning.transitionBurstDurationMs}ms`,
    `--portrait-transition-burst-intensity:${tuning.transitionBurstIntensity}`,
    `--portrait-brightness:${tuning.brightness}`,
    `--portrait-contrast:${tuning.contrast}`,
    `--portrait-posterize-boost:${tuning.posterizeBoost}`,
    `--portrait-monochrome-strength:${tuning.monochromeTintStrength}`,
    `--portrait-jitter-frequency:${tuning.jitterFrequencySpeakingMs}ms`,
    `--portrait-jitter-magnitude:${tuning.jitterMagnitudePx}px`,
    `--portrait-glow-intensity:${tuning.glowIntensity}`,
    `--portrait-sweep-opacity:${tuning.interferenceSweepOpacity}`,
  ].join(';');
}

export const CODEC_SIGNAL_FX_TUNING = {
  idleDriftAmplitudePx: 1,
  idleDriftDurationMs: 1500,
  speakingDriftAmplitudePx: 2,
  speakingDriftDurationMs: 760,
} as const;

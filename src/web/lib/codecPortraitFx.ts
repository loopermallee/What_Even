export const CODEC_PORTRAIT_FX_TUNING = {
  scanlineOpacity: 0.16,
  scanlineSpacingPx: 3,
  staticOpacityIdle: 0.08,
  staticOpacitySpeaking: 0.16,
  staticOpacityTransition: 0.36,
  staticBandOpacityIdle: 0.12,
  staticBandOpacitySpeaking: 0.2,
  staticBandOpacityTransition: 0.4,
  staticBandSpeedIdleMs: 5200,
  staticBandSpeedSpeakingMs: 3400,
  staticBandSpeedTransitionMs: 1100,
  transitionBurstDurationMs: 190,
  transitionBurstIntensity: 0.72,
  brightness: 1.03,
  contrast: 1.12,
  posterizeBoost: 1.05,
  monochromeTintStrength: 0.86,
  jitterFrequencySpeakingMs: 780,
  jitterMagnitudePx: 1,
  glowIntensity: 0.3,
  interferenceSweepOpacity: 0.2,
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

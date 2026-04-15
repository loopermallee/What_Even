import type { CodecCharacterId } from '../../app/types';
import { toPortraitCssVars } from '../lib/codecPortraitFx';

export function renderCodecPortrait(options: {
  label: string;
  tag: string;
  characterId?: CodecCharacterId;
  active: boolean;
  mouthOpen: boolean;
}) {
  const spriteCharacter = options.characterId === 'snake'
    || options.characterId === 'otacon'
    || options.characterId === 'meryl'
    || options.characterId === 'colonel'
    ? options.characterId
    : '';

  const portraitState = options.active && options.mouthOpen ? 'speaking' : 'idle';

  return `
    <div class="portrait-frame ${options.active ? 'active' : ''}" style="${toPortraitCssVars()}">
      <div class="portrait-header">
        <div class="portrait-label">${options.label}</div>
      </div>
      <div
        class="portrait-face ${spriteCharacter ? 'portrait-face-sprite-capable' : ''}"
        data-portrait-state="${portraitState}"
        data-portrait-character="${spriteCharacter}"
        data-codec-sprite-character="${spriteCharacter}"
        data-codec-sprite-speaking="${spriteCharacter ? String(options.mouthOpen) : 'false'}"
      >
        <div class="portrait-viewport">
          <div class="portrait-silhouette">${options.tag}</div>
          ${spriteCharacter ? '<canvas class="codec-sprite-canvas" aria-hidden="true"></canvas>' : ''}

          <div class="portrait-grade-layer" aria-hidden="true"></div>
          <div class="portrait-scanline-layer" aria-hidden="true"></div>

          <div class="portrait-radio-layer" aria-hidden="true">
            <div class="portrait-static-band"></div>
            <div class="portrait-interference-sweep"></div>
          </div>

          <div class="portrait-transition-burst" aria-hidden="true"></div>
          <div class="portrait-glow-layer" aria-hidden="true"></div>

          <div class="mouth-slot ${options.mouthOpen ? 'open' : ''}">
            <div class="mouth-core"></div>
          </div>
        </div>
      </div>
      <div class="portrait-tag">${options.tag}</div>
    </div>
  `;
}

import { toPortraitCssVars } from '../lib/codecPortraitFx';
import type { CodecBlinkState, CodecCharacterId, CodecExpression, CodecMouthFrame } from '../../app/types';

export function renderCodecPortrait(options: {
  label: string;
  tag: string;
  characterId?: CodecCharacterId;
  active: boolean;
  expression: CodecExpression;
  blink: CodecBlinkState;
  mouth: CodecMouthFrame;
}) {
  const spriteCharacter = options.characterId === 'snake'
    || options.characterId === 'otacon'
    || options.characterId === 'meryl'
    || options.characterId === 'colonel'
    ? options.characterId
    : '';

  const portraitState = options.active && options.mouth !== 'closed' ? 'speaking' : 'idle';

  return `
    <div class="portrait-frame ${options.active ? 'active' : ''}" style="${toPortraitCssVars()}">
      <div class="portrait-header">
        <div class="portrait-label">${options.label}</div>
      </div>
      <div
        class="portrait-face ${spriteCharacter ? 'portrait-face-sprite-capable' : ''}"
        data-portrait-state="${portraitState}"
        data-portrait-character="${spriteCharacter}"
        data-portrait-expression="${options.expression}"
        data-codec-sprite-character="${spriteCharacter}"
        data-codec-sprite-expression="${options.expression}"
      >
        <div class="portrait-viewport">
          <div class="portrait-silhouette">${options.tag}</div>
          ${spriteCharacter ? '<canvas class="codec-sprite-canvas" aria-hidden="true"></canvas>' : ''}
          <div class="portrait-grade-layer" aria-hidden="true"></div>
          <div class="portrait-scanline-layer" aria-hidden="true"></div>
          <div class="portrait-radio-layer" aria-hidden="true"></div>
          <div class="portrait-expression-layer portrait-expression-${options.expression}" aria-hidden="true"></div>
          <div class="portrait-eyes-layer" data-blink-state="${options.blink}" aria-hidden="true">
            <span class="portrait-eye portrait-eye-left"></span>
            <span class="portrait-eye portrait-eye-right"></span>
          </div>
          <div class="portrait-mouth-layer" data-mouth-frame="${options.mouth}" aria-hidden="true">
            <span class="portrait-mouth-core"></span>
          </div>
          <div class="portrait-static-overlay" aria-hidden="true">
            <div class="portrait-static-band"></div>
            <div class="portrait-interference-sweep"></div>
          </div>
          <div class="portrait-transition-burst" aria-hidden="true"></div>
          <div class="portrait-glow-layer" aria-hidden="true"></div>
        </div>
      </div>
      <div class="portrait-tag">${options.tag}</div>
    </div>
  `;
}

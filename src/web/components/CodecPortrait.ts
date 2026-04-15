import { toPortraitCssVars } from '../lib/codecPortraitFx';
import type {
  CodecCharacterId,
  CodecExpression,
  CodecPortraitFamily,
  CodecPortraitFrameKey,
  CodecPortraitFrameRect,
} from '../../app/types';

function formatFrameRect(frameRect: CodecPortraitFrameRect | null) {
  if (!frameRect) {
    return '';
  }

  return `${frameRect.x},${frameRect.y},${frameRect.width},${frameRect.height}`;
}

export function renderCodecPortrait(options: {
  label: string;
  tag: string;
  characterId?: CodecCharacterId;
  active: boolean;
  portraitState: 'idle' | 'speaking';
  expression: CodecExpression;
  family: CodecPortraitFamily;
  frameKey: CodecPortraitFrameKey | null;
  frameRect: CodecPortraitFrameRect | null;
  usesManifestFrame: boolean;
}) {
  const spriteCharacter = options.characterId === 'snake'
    || options.characterId === 'otacon'
    || options.characterId === 'meryl'
    || options.characterId === 'colonel'
    ? options.characterId
    : '';

  return `
    <div class="portrait-frame ${options.active ? 'active' : ''}" style="${toPortraitCssVars()}">
      <div class="portrait-header">
        <div class="portrait-label">${options.label}</div>
      </div>
      <div
        class="portrait-face ${spriteCharacter ? 'portrait-face-sprite-capable' : ''}"
        data-portrait-state="${options.portraitState}"
        data-portrait-character="${spriteCharacter}"
        data-portrait-expression="${options.expression}"
        data-portrait-family="${options.family}"
        data-codec-sprite-character="${spriteCharacter}"
        data-codec-sprite-frame-key="${options.frameKey ?? ''}"
        data-codec-sprite-frame-rect="${formatFrameRect(options.frameRect)}"
        data-codec-sprite-uses-manifest="${options.usesManifestFrame ? 'true' : 'false'}"
      >
        <div class="portrait-viewport">
          <div class="portrait-silhouette">${options.tag}</div>
          ${spriteCharacter ? '<canvas class="codec-sprite-canvas" aria-hidden="true"></canvas>' : ''}
          <div class="portrait-grade-layer" aria-hidden="true"></div>
          <div class="portrait-scanline-layer" aria-hidden="true"></div>
          <div class="portrait-radio-layer" aria-hidden="true"></div>
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

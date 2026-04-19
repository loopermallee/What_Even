import {
  getCodecPortraitFrameWithFallback,
  getCodecPortraitManifest,
} from '../../app/codecPortraitManifest';
import type { CodecCharacterId, CodecPortraitFamily, CodecPortraitFrameKey } from '../../app/types';

const PORTRAIT_VIEWPORT_WIDTH = 112;
const PORTRAIT_VIEWPORT_HEIGHT = 148;

const sheetCache = new Map<CodecCharacterId, Promise<HTMLImageElement>>();

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load sprite sheet: ${url}`));
    image.src = url;
  });
}

function getSpriteSheet(characterId: CodecCharacterId) {
  const cached = sheetCache.get(characterId);
  if (cached) {
    return cached;
  }

  const promise = loadImage(getCodecPortraitManifest(characterId).sheetUrl);
  sheetCache.set(characterId, promise);
  return promise;
}

function drawFrame(
  canvas: HTMLCanvasElement,
  characterId: CodecCharacterId,
  image: HTMLImageElement,
  frameKey: CodecPortraitFrameKey,
) {
  const frame = getCodecPortraitFrameWithFallback({
    characterId,
    family: frameKey.includes('.alert.') ? 'alert' : 'neutral',
    frameKey,
  });
  if (!frame) {
    throw new Error(`No sprite frame available for ${characterId}.`);
  }

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context unavailable for sprite portrait rendering.');
  }

  const bounds = canvas.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  const viewportWidth = Math.max(1, Math.round((bounds.width || PORTRAIT_VIEWPORT_WIDTH) * devicePixelRatio));
  const viewportHeight = Math.max(1, Math.round((bounds.height || PORTRAIT_VIEWPORT_HEIGHT) * devicePixelRatio));

  if (canvas.width !== viewportWidth || canvas.height !== viewportHeight) {
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
  }

  const portraitPreset = getCodecPortraitManifest(characterId).webCrop;
  const scale = Math.max(viewportWidth / frame.rect.width, viewportHeight / frame.rect.height) * portraitPreset.zoom;
  const drawWidth = Math.ceil(frame.rect.width * scale);
  const drawHeight = Math.ceil(frame.rect.height * scale);
  const drawX = Math.round((viewportWidth - drawWidth) / 2 + (portraitPreset.offsetX * devicePixelRatio));
  const drawY = Math.round((viewportHeight - drawHeight) / 2 + (portraitPreset.offsetY * devicePixelRatio));

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    frame.rect.x,
    frame.rect.y,
    frame.rect.width,
    frame.rect.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
}

function parseCharacterId(value: string | undefined): CodecCharacterId | null {
  if (value === 'snake' || value === 'otacon' || value === 'meryl' || value === 'colonel' || value === 'meiling') {
    return value;
  }

  return null;
}

function parseFamily(value: string | undefined): CodecPortraitFamily {
  return value === 'alert' ? 'alert' : 'neutral';
}

function parseFrameKey(value: string | undefined): CodecPortraitFrameKey | null {
  if (!value) {
    return null;
  }

  return value as CodecPortraitFrameKey;
}

function formatFrameRect(frameRect: { x: number; y: number; width: number; height: number }) {
  return `${frameRect.x},${frameRect.y},${frameRect.width},${frameRect.height}`;
}

export function syncCodecSpritePortraits(root: ParentNode) {
  const canvases = root.querySelectorAll<HTMLCanvasElement>('.codec-sprite-canvas');

  for (const canvas of canvases) {
    const face = canvas.closest<HTMLElement>('.portrait-face');
    if (!face) {
      continue;
    }

    const characterId = parseCharacterId(face.dataset.codecSpriteCharacter);
    if (!characterId) {
      continue;
    }

    const family = parseFamily(face.dataset.portraitFamily);
    const requestedFrameKey = parseFrameKey(face.dataset.codecSpriteFrameKey);
    const resolvedFrame = getCodecPortraitFrameWithFallback({
      characterId,
      family,
      frameKey: requestedFrameKey,
    });

    if (!resolvedFrame) {
      face.classList.remove('sprite-ready');
      face.dataset.spriteStatus = 'failed';
      face.dataset.codecSpriteResolvedFrameKey = '';
      face.dataset.codecSpriteResolvedFrameRect = '';
      face.dataset.codecSpriteUsesManifest = 'false';
      delete face.dataset.codecSpriteRendered;
      continue;
    }

    const drawKey = `${characterId}:${resolvedFrame.key}:${formatFrameRect(resolvedFrame.rect)}`;
    if (face.dataset.codecSpriteRendered === drawKey) {
      continue;
    }

    getSpriteSheet(characterId)
      .then((image) => {
        drawFrame(canvas, characterId, image, resolvedFrame.key);
        face.classList.add('sprite-ready');
        face.dataset.spriteStatus = 'ready';
        face.dataset.codecSpriteRendered = drawKey;
        face.dataset.codecSpriteResolvedFrameKey = resolvedFrame.key;
        face.dataset.codecSpriteResolvedFrameRect = formatFrameRect(resolvedFrame.rect);
        face.dataset.codecSpriteUsesManifest = 'true';
      })
      .catch(() => {
        face.classList.remove('sprite-ready');
        face.dataset.spriteStatus = 'failed';
        face.dataset.codecSpriteResolvedFrameKey = '';
        face.dataset.codecSpriteResolvedFrameRect = '';
        face.dataset.codecSpriteUsesManifest = 'false';
        delete face.dataset.codecSpriteRendered;
      });
  }
}

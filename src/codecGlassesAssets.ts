import {
  getCodecPortraitFrameWithFallback,
  getCodecPortraitManifest,
} from './app/codecPortraitManifest';
import type { CodecCharacterId, CodecPortraitFrameKey } from './app/types';

export type CodecAssetKey =
  | 'frame-incoming'
  | 'frame-active'
  | 'frame-ended'
  | 'portrait-colonel'
  | 'portrait-colonel-alert'
  | 'portrait-meiling'
  | 'portrait-meiling-alert'
  | 'portrait-meryl'
  | 'portrait-meryl-alert'
  | 'portrait-otacon'
  | 'portrait-otacon-alert'
  | 'portrait-snake'
  | 'portrait-snake-alert';

const assetCache = new Map<CodecAssetKey, Uint8Array>();
const sheetCache = new Map<CodecCharacterId, Promise<HTMLImageElement>>();

type FrameAssetDefinition = {
  width: number;
  height: number;
  svg: string;
};

type PortraitAssetDefinition = {
  characterId: CodecCharacterId;
  frameKey: CodecPortraitFrameKey;
};

function frameSvg(mode: 'incoming' | 'active' | 'ended') {
  const stroke = mode === 'ended' ? '#739d87' : '#a2ffd1';
  const glow = mode === 'ended' ? '#0d2119' : '#113126';
  const tag = mode === 'incoming' ? 'RING' : mode === 'active' ? 'LINK' : 'DONE';

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" fill="#030705"/>
  <rect x="2" y="2" width="196" height="96" fill="none" stroke="${stroke}" stroke-width="2"/>
  <rect x="8" y="8" width="184" height="84" fill="none" stroke="${glow}" stroke-width="1"/>
  <line x1="36" y1="20" x2="164" y2="20" stroke="${stroke}" stroke-width="1"/>
  <line x1="36" y1="80" x2="164" y2="80" stroke="${stroke}" stroke-width="1"/>
  <rect x="70" y="11" width="60" height="12" fill="#0f251b" stroke="${stroke}" stroke-width="1"/>
  <text x="100" y="20" text-anchor="middle" fill="${stroke}" font-size="8" font-family="monospace">${tag}</text>
  <rect x="38" y="30" width="124" height="42" fill="#05130d" stroke="${stroke}" stroke-width="1"/>
  <rect x="46" y="39" width="44" height="24" fill="#a2ffd1" opacity="0.2"/>
  <rect x="42" y="74" width="116" height="6" fill="#0f251b" stroke="${stroke}" stroke-width="1"/>
</svg>`;
}

function getFrameAssetDefinition(key: CodecAssetKey): FrameAssetDefinition | null {
  if (key === 'frame-incoming') {
    return { width: 200, height: 100, svg: frameSvg('incoming') };
  }

  if (key === 'frame-active') {
    return { width: 200, height: 100, svg: frameSvg('active') };
  }

  if (key === 'frame-ended') {
    return { width: 200, height: 100, svg: frameSvg('ended') };
  }

  return null;
}

function getPortraitAssetDefinition(key: CodecAssetKey): PortraitAssetDefinition | null {
  if (key === 'portrait-snake') {
    return { characterId: 'snake', frameKey: 'snake.neutral.idle' };
  }
  if (key === 'portrait-snake-alert') {
    return { characterId: 'snake', frameKey: 'snake.alert.idle' };
  }
  if (key === 'portrait-colonel') {
    return { characterId: 'colonel', frameKey: 'colonel.neutral.idle' };
  }
  if (key === 'portrait-colonel-alert') {
    return { characterId: 'colonel', frameKey: 'colonel.alert.idle' };
  }
  if (key === 'portrait-meiling') {
    return { characterId: 'meiling', frameKey: 'meiling.neutral.idle' };
  }
  if (key === 'portrait-meiling-alert') {
    return { characterId: 'meiling', frameKey: 'meiling.alert.idle' };
  }
  if (key === 'portrait-meryl') {
    return { characterId: 'meryl', frameKey: 'meryl.neutral.idle' };
  }
  if (key === 'portrait-meryl-alert') {
    return { characterId: 'meryl', frameKey: 'meryl.alert.idle' };
  }
  if (key === 'portrait-otacon') {
    return { characterId: 'otacon', frameKey: 'otacon.neutral.idle' };
  }
  if (key === 'portrait-otacon-alert') {
    return { characterId: 'otacon', frameKey: 'otacon.alert.idle' };
  }

  return null;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load portrait sheet: ${url}`));
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

async function svgToPngBytes(svg: string, width: number, height: number) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load SVG asset into image.'));
      img.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable.');
    }

    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG blob generation failed.'));
          return;
        }

        resolve(blob);
      }, 'image/png');
    });

    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function renderPortraitPngBytes(definition: PortraitAssetDefinition) {
  const resolvedFrame = getCodecPortraitFrameWithFallback({
    characterId: definition.characterId,
    family: definition.frameKey.includes('.alert.') ? 'alert' : 'neutral',
    frameKey: definition.frameKey,
  });
  if (!resolvedFrame) {
    throw new Error(`No portrait frame found for ${definition.frameKey}.`);
  }

  const image = await getSpriteSheet(definition.characterId);
  const crop = getCodecPortraitManifest(definition.characterId).glassCrop;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context unavailable for portrait rendering.');
  }

  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(canvas.width / resolvedFrame.rect.width, canvas.height / resolvedFrame.rect.height) * crop.zoom;
  const drawWidth = Math.ceil(resolvedFrame.rect.width * scale);
  const drawHeight = Math.ceil(resolvedFrame.rect.height * scale);
  const drawX = Math.round((canvas.width - drawWidth) / 2 + crop.offsetX);
  const drawY = Math.round((canvas.height - drawHeight) / 2 + crop.offsetY);

  context.drawImage(
    image,
    resolvedFrame.rect.x,
    resolvedFrame.rect.y,
    resolvedFrame.rect.width,
    resolvedFrame.rect.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG blob generation failed.'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });

  return new Uint8Array(await pngBlob.arrayBuffer());
}

export async function getCodecAssetBytes(key: CodecAssetKey) {
  const cached = assetCache.get(key);
  if (cached) {
    return cached;
  }

  const frameAsset = getFrameAssetDefinition(key);
  if (frameAsset) {
    const bytes = await svgToPngBytes(frameAsset.svg, frameAsset.width, frameAsset.height);
    assetCache.set(key, bytes);
    return bytes;
  }

  const portraitAsset = getPortraitAssetDefinition(key);
  if (!portraitAsset) {
    throw new Error(`Unknown codec asset key: ${key}`);
  }

  const bytes = await renderPortraitPngBytes(portraitAsset);
  assetCache.set(key, bytes);
  return bytes;
}

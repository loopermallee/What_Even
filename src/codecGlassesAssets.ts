import {
  getCodecPortraitFrameWithFallback,
  getCodecPortraitManifest,
} from './app/codecPortraitManifest';
import type { CodecCharacterId, CodecPortraitFrameKey } from './app/types';
import type { GlassArrowPulseDirection, GlassCenterModuleVariant, PortraitAsset } from './glass/shared';

export type CodecImageRenderRequest =
  | {
    kind: 'portrait-panel';
    side: 'left' | 'right';
    portraitAsset: PortraitAsset;
    active: boolean;
  }
  | {
    kind: 'center-module';
    variant: GlassCenterModuleVariant;
    barBucket: number;
    arrowPulseDirection: GlassArrowPulseDirection;
  };

const assetCache = new Map<string, Uint8Array>();
const sheetCache = new Map<CodecCharacterId, Promise<HTMLImageElement>>();

type PortraitRenderDefinition = {
  characterId: CodecCharacterId;
  frameKey: CodecPortraitFrameKey;
  family: 'neutral' | 'alert';
};

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

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
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

function getPortraitDefinition(asset: PortraitAsset, side: 'left' | 'right'): PortraitRenderDefinition {
  const isAlert = asset.endsWith('-alert');
  const base = asset.replace(/-alert$/, '') as PortraitAsset;

  if (base === 'portrait-colonel') {
    return {
      characterId: 'colonel',
      frameKey: 'colonel.neutral.idle',
      family: isAlert ? 'alert' : 'neutral',
    };
  }

  if (base === 'portrait-meiling') {
    return {
      characterId: 'meiling',
      frameKey: 'meiling.neutral.idle',
      family: isAlert ? 'alert' : 'neutral',
    };
  }

  if (base === 'portrait-meryl') {
    return {
      characterId: 'meryl',
      frameKey: 'meryl.neutral.idle',
      family: isAlert ? 'alert' : 'neutral',
    };
  }

  if (base === 'portrait-otacon') {
    return {
      characterId: 'otacon',
      frameKey: 'otacon.neutral.idle',
      family: isAlert ? 'alert' : 'neutral',
    };
  }

  if (side === 'right') {
    return {
      characterId: 'snake',
      frameKey: 'snake.neutral.idle',
      family: isAlert ? 'alert' : 'neutral',
    };
  }

  return {
    characterId: 'snake',
    frameKey: 'snake.neutral.idle',
    family: isAlert ? 'alert' : 'neutral',
  };
}

function drawFrameGlow(context: CanvasRenderingContext2D, width: number, height: number, active: boolean) {
  const glow = active ? 'rgba(151,255,191,0.75)' : 'rgba(101,224,138,0.42)';
  const stroke = active ? '#b8ffd0' : '#79e995';
  const dim = '#163424';

  context.save();
  context.shadowColor = glow;
  context.shadowBlur = active ? 18 : 10;
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.strokeRect(7, 6, width - 14, height - 12);
  context.shadowBlur = 0;
  context.strokeStyle = dim;
  context.lineWidth = 1;
  context.strokeRect(11, 10, width - 22, height - 20);
  context.restore();
}

async function renderPortraitPanelBytes(request: Extract<CodecImageRenderRequest, { kind: 'portrait-panel' }>) {
  const definition = getPortraitDefinition(request.portraitAsset, request.side);
  const resolvedFrame = getCodecPortraitFrameWithFallback({
    characterId: definition.characterId,
    family: definition.family,
    frameKey: definition.frameKey,
  });
  if (!resolvedFrame) {
    throw new Error(`No portrait frame found for ${definition.frameKey}.`);
  }

  const image = await getSpriteSheet(definition.characterId);
  const crop = getCodecPortraitManifest(definition.characterId).glassCrop;
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 132;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context unavailable for portrait rendering.');
  }

  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawFrameGlow(context, canvas.width, canvas.height, request.active);

  const viewport = { x: 16, y: 14, width: 88, height: 104 };
  context.save();
  context.beginPath();
  context.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  context.clip();

  const scale = Math.max(viewport.width / resolvedFrame.rect.width, viewport.height / resolvedFrame.rect.height) * crop.zoom * 1.1;
  const drawWidth = Math.ceil(resolvedFrame.rect.width * scale);
  const drawHeight = Math.ceil(resolvedFrame.rect.height * scale);
  const drawX = Math.round(viewport.x + (viewport.width - drawWidth) / 2 + crop.offsetX);
  const drawY = Math.round(viewport.y + (viewport.height - drawHeight) / 2 + crop.offsetY - 3);

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
  context.restore();

  context.fillStyle = request.active ? 'rgba(162,255,201,0.08)' : 'rgba(104,205,134,0.05)';
  context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  context.strokeStyle = request.active ? '#9fffba' : '#5aa66e';
  context.lineWidth = 1;
  context.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);

  for (let y = viewport.y; y < viewport.y + viewport.height; y += 4) {
    context.fillStyle = y % 8 === 0 ? 'rgba(194,255,214,0.03)' : 'rgba(0,0,0,0.08)';
    context.fillRect(viewport.x, y, viewport.width, 1);
  }

  return canvasToPngBytes(canvas);
}

function drawSignalBars(context: CanvasRenderingContext2D, level: number) {
  const clamped = Math.max(0, Math.min(10, Math.round(level)));
  const bars = 7;
  const barWidth = 52;
  const barHeight = 4;
  const gap = 2;
  const startX = 88;
  const startY = 34;

  for (let index = 0; index < bars; index += 1) {
    const isActive = index < Math.max(1, Math.round((clamped / 10) * bars));
    context.fillStyle = isActive ? '#d7ffe6' : 'rgba(160,255,196,0.18)';
    context.fillRect(startX, startY + index * (barHeight + gap), barWidth - index * 4, barHeight);
  }
}

function drawDirectionArrows(context: CanvasRenderingContext2D, pulseDirection: GlassArrowPulseDirection) {
  const leftColor = pulseDirection === 'left' ? '#d7ffe6' : 'rgba(114,255,173,0.30)';
  const rightColor = pulseDirection === 'right' ? '#d7ffe6' : 'rgba(114,255,173,0.30)';
  const leftGlow = pulseDirection === 'left' ? 'rgba(185,255,219,0.65)' : 'rgba(114,255,173,0.22)';
  const rightGlow = pulseDirection === 'right' ? 'rgba(185,255,219,0.65)' : 'rgba(114,255,173,0.22)';

  context.save();
  context.shadowBlur = 6;
  context.shadowColor = leftGlow;
  context.fillStyle = leftColor;
  context.beginPath();
  context.moveTo(18, 54);
  context.lineTo(34, 44);
  context.lineTo(34, 64);
  context.closePath();
  context.fill();

  context.shadowColor = rightGlow;
  context.fillStyle = rightColor;
  context.beginPath();
  context.moveTo(266, 54);
  context.lineTo(250, 44);
  context.lineTo(250, 64);
  context.closePath();
  context.fill();
  context.restore();
}

async function renderCenterModuleBytes(request: Extract<CodecImageRenderRequest, { kind: 'center-module' }>) {
  const canvas = document.createElement('canvas');
  canvas.width = 284;
  canvas.height = 144;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context unavailable for center module rendering.');
  }

  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const stroke = request.variant === 'ended' ? '#7ea58f' : '#92f9ae';
  const dim = '#163424';

  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.strokeRect(58, 18, 168, 72);
  context.strokeStyle = dim;
  context.lineWidth = 1;
  context.strokeRect(62, 22, 160, 64);

  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(8, 18);
  context.lineTo(74, 18);
  context.moveTo(210, 18);
  context.lineTo(276, 18);
  context.moveTo(8, 108);
  context.lineTo(96, 108);
  context.moveTo(188, 108);
  context.lineTo(276, 108);
  context.stroke();

  context.fillStyle = '#08110d';
  context.fillRect(70, 30, 144, 48);
  context.strokeStyle = stroke;
  context.strokeRect(70, 30, 144, 48);

  drawSignalBars(context, request.barBucket);
  drawDirectionArrows(context, request.arrowPulseDirection);

  return canvasToPngBytes(canvas);
}

export async function renderCodecImageBytes(request: CodecImageRenderRequest) {
  const cacheKey = JSON.stringify(request);
  const cached = assetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bytes = request.kind === 'portrait-panel'
    ? await renderPortraitPanelBytes(request)
    : await renderCenterModuleBytes(request);
  assetCache.set(cacheKey, bytes);
  return bytes;
}

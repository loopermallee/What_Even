import type { CodecExpression, CodecCharacterId } from '../../app/types';

type SpriteCharacterId = CodecCharacterId;

type FrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PortraitCropPreset = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

type CharacterSpriteConfig = {
  sheetUrl: string;
  excludedIndexes?: number[];
  expressions: Partial<Record<CodecExpression, number[]>>;
  portraitPreset?: PortraitCropPreset;
};

type SpriteSheetData = {
  image: HTMLImageElement;
  frames: FrameRect[];
};

const FRAME_WIDTH_MIN = 44;
const FRAME_WIDTH_MAX = 60;
const FRAME_HEIGHT_MIN = 80;
const FRAME_HEIGHT_MAX = 96;
const PORTRAIT_VIEWPORT_WIDTH = 112;
const PORTRAIT_VIEWPORT_HEIGHT = 148;

const snakeSheetUrl = new URL('../assets/codec/snake-sheet.png', import.meta.url).href;
const otaconSheetUrl = new URL('../assets/codec/otacon-sheet.png', import.meta.url).href;
const merylSheetUrl = new URL('../assets/codec/meryl-sheet.png', import.meta.url).href;
const colonelSheetUrl = new URL('../assets/codec/colonel-sheet.png', import.meta.url).href;

const spriteConfigs: Record<SpriteCharacterId, CharacterSpriteConfig> = {
  otacon: {
    sheetUrl: otaconSheetUrl,
    expressions: {
      idle: [0],
      stern: [12],
      angry: [20],
      surprised: [22],
      thinking: [18],
      hurt: [23],
    },
    portraitPreset: {
      zoom: 1.18,
      offsetY: -4,
    },
  },
  snake: {
    sheetUrl: snakeSheetUrl,
    excludedIndexes: [35, 36, 37, 40, 41],
    expressions: {
      idle: [0],
      stern: [14],
      angry: [19],
      surprised: [29],
      thinking: [18],
      hurt: [42, 44],
    },
    portraitPreset: {
      zoom: 1.16,
      offsetX: -3,
      offsetY: -3,
    },
  },
  meryl: {
    sheetUrl: merylSheetUrl,
    expressions: {
      idle: [13],
      stern: [18],
      angry: [29],
      surprised: [31],
      thinking: [20],
      hurt: [32],
    },
    portraitPreset: {
      zoom: 1.2,
      offsetY: -5,
    },
  },
  colonel: {
    sheetUrl: colonelSheetUrl,
    expressions: {
      idle: [0],
      stern: [12],
      angry: [8],
      surprised: [10],
      thinking: [18],
      hurt: [15],
    },
    portraitPreset: {
      zoom: 1.22,
      offsetY: -6,
    },
  },
};

const sheetCache = new Map<SpriteCharacterId, Promise<SpriteSheetData>>();
const frameCache = new Map<string, Promise<{ image: HTMLImageElement; frame: FrameRect }>>();

function colorDistance(a: number, b: number) {
  return Math.abs(a - b);
}

function isBackgroundPixel(data: Uint8ClampedArray, offset: number, background: [number, number, number]) {
  return colorDistance(data[offset], background[0]) <= 10
    && colorDistance(data[offset + 1], background[1]) <= 10
    && colorDistance(data[offset + 2], background[2]) <= 10;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load sprite sheet: ${url}`));
    image.src = url;
  });
}

async function extractFrames(characterId: SpriteCharacterId, url: string): Promise<SpriteSheetData> {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error(`Canvas 2D context unavailable for ${characterId}.`);
  }

  context.drawImage(image, 0, 0);
  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const visited = new Uint8Array(width * height);
  const background: [number, number, number] = [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0];
  const queue = new Uint32Array(width * height);
  const frames: FrameRect[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        continue;
      }

      visited[pixelIndex] = 1;
      const offset = pixelIndex * 4;
      if (isBackgroundPixel(pixels, offset, background)) {
        continue;
      }

      let head = 0;
      let tail = 0;
      queue[tail] = pixelIndex;
      tail += 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (head < tail) {
        const currentIndex = queue[head];
        head += 1;
        const currentX = currentIndex % width;
        const currentY = Math.floor(currentIndex / width);

        if (currentX < minX) minX = currentX;
        if (currentX > maxX) maxX = currentX;
        if (currentY < minY) minY = currentY;
        if (currentY > maxY) maxY = currentY;

        const neighbors = [
          currentIndex - 1,
          currentIndex + 1,
          currentIndex - width,
          currentIndex + width,
        ];

        for (const neighborIndex of neighbors) {
          if (neighborIndex < 0 || neighborIndex >= visited.length || visited[neighborIndex]) {
            continue;
          }

          const neighborX = neighborIndex % width;
          const neighborY = Math.floor(neighborIndex / width);
          if (Math.abs(neighborX - currentX) + Math.abs(neighborY - currentY) !== 1) {
            continue;
          }

          visited[neighborIndex] = 1;
          const neighborOffset = neighborIndex * 4;
          if (isBackgroundPixel(pixels, neighborOffset, background)) {
            continue;
          }

          queue[tail] = neighborIndex;
          tail += 1;
        }
      }

      const frame = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };

      if (frame.width >= FRAME_WIDTH_MIN
        && frame.width <= FRAME_WIDTH_MAX
        && frame.height >= FRAME_HEIGHT_MIN
        && frame.height <= FRAME_HEIGHT_MAX) {
        frames.push(frame);
      }
    }
  }

  frames.sort((left, right) => {
    const rowDelta = Math.round(left.y / 12) - Math.round(right.y / 12);
    return rowDelta !== 0 ? rowDelta : left.x - right.x;
  });

  return { image, frames };
}

function getSpriteSheet(characterId: SpriteCharacterId) {
  const cached = sheetCache.get(characterId);
  if (cached) {
    return cached;
  }

  const promise = extractFrames(characterId, spriteConfigs[characterId].sheetUrl);
  sheetCache.set(characterId, promise);
  return promise;
}

function resolveExpressionIndexes(config: CharacterSpriteConfig, expression: CodecExpression) {
  return config.expressions[expression]
    ?? config.expressions.stern
    ?? config.expressions.idle
    ?? [0];
}

function getExpressionFrame(characterId: SpriteCharacterId, expression: CodecExpression) {
  const cacheKey = `${characterId}:${expression}`;
  const cached = frameCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const config = spriteConfigs[characterId];
  const requestedIndexes = resolveExpressionIndexes(config, expression);
  const excluded = new Set(config.excludedIndexes ?? []);
  const promise = getSpriteSheet(characterId).then(({ image, frames }) => {
    const frame = requestedIndexes
      .map((index) => (!excluded.has(index) ? frames[index] ?? null : null))
      .find((candidate): candidate is FrameRect => candidate !== null)
      ?? frames.find((_frame, index) => !excluded.has(index))
      ?? frames[0];

    if (!frame) {
      throw new Error(`No sprite frames available for ${characterId}.`);
    }

    return { image, frame };
  });

  frameCache.set(cacheKey, promise);
  return promise;
}

function drawFrame(canvas: HTMLCanvasElement, characterId: SpriteCharacterId, image: HTMLImageElement, frame: FrameRect) {
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

  const config = spriteConfigs[characterId];
  const portraitPreset = config.portraitPreset ?? {};
  const zoom = portraitPreset.zoom ?? 1;
  const scale = Math.max(viewportWidth / frame.width, viewportHeight / frame.height) * zoom;
  const drawWidth = Math.ceil(frame.width * scale);
  const drawHeight = Math.ceil(frame.height * scale);
  const drawX = Math.round((viewportWidth - drawWidth) / 2 + ((portraitPreset.offsetX ?? 0) * devicePixelRatio));
  const drawY = Math.round((viewportHeight - drawHeight) / 2 + ((portraitPreset.offsetY ?? 0) * devicePixelRatio));

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
}

function parseCharacterId(value: string | undefined): SpriteCharacterId | null {
  if (value === 'snake' || value === 'otacon' || value === 'meryl' || value === 'colonel') {
    return value;
  }

  return null;
}

function parseExpression(value: string | undefined): CodecExpression {
  if (value === 'idle'
    || value === 'stern'
    || value === 'angry'
    || value === 'surprised'
    || value === 'thinking'
    || value === 'hurt') {
    return value;
  }

  return 'idle';
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

    const expression = parseExpression(face.dataset.codecSpriteExpression);
    const drawKey = `${characterId}:${expression}`;
    if (face.dataset.codecSpriteRendered === drawKey) {
      continue;
    }

    getExpressionFrame(characterId, expression)
      .then(({ image, frame }) => {
        face.classList.add('sprite-ready');
        face.dataset.spriteStatus = 'ready';
        face.dataset.codecSpriteRendered = drawKey;
        drawFrame(canvas, characterId, image, frame);
      })
      .catch(() => {
        face.classList.remove('sprite-ready');
        face.dataset.spriteStatus = 'failed';
        delete face.dataset.codecSpriteRendered;
      });
  }
}

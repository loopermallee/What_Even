import type { CodecCharacterId } from '../../app/types';

type SpriteCharacterId = CodecCharacterId;
type FrameUsageKind = 'idle' | 'speaking';

type FrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CharacterSpriteConfig = {
  sheetUrl: string;
  excludedIndexes?: number[];
  idleFrames: number[];
  speakingFrames: number[];
  portraitPreset?: PortraitCropPreset;
};

type PortraitCropPreset = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

type SpriteSheetData = {
  image: HTMLImageElement;
  frames: FrameRect[];
};

type ResolvedFrameSet = {
  image: HTMLImageElement;
  frames: FrameRect[];
  resolvedIndexes: number[];
  missingRequestedIndexes: number[];
  usedFallbackIndexes: boolean;
};

type PortraitController = {
  canvas: HTMLCanvasElement;
  characterId: SpriteCharacterId;
  speaking: boolean;
  idleFrameIndex: number;
  speakingFrameIndex: number;
  idleFrameShownUntil: number;
  nextIdleSwapAt: number;
};

type CharacterDebugState = {
  extractedFrameCount: number;
  fallbackUsed: boolean;
  idleResolvedIndexes: number[];
  idleMissingIndexes: number[];
  speakingResolvedIndexes: number[];
  speakingMissingIndexes: number[];
  spriteStatus: 'pending' | 'ready' | 'failed';
};

const FRAME_WIDTH_MIN = 44;
const FRAME_WIDTH_MAX = 60;
const FRAME_HEIGHT_MIN = 80;
const FRAME_HEIGHT_MAX = 96;
const PORTRAIT_VIEWPORT_WIDTH = 112;
const PORTRAIT_VIEWPORT_HEIGHT = 148;
const TALK_FRAME_MS = 150;
const IDLE_MIN_INTERVAL_MS = 2200;
const IDLE_MAX_INTERVAL_MS = 4200;
const IDLE_ALT_FRAME_MS = 150;
const DEV_MODE = Boolean(import.meta.env.DEV);

const snakeSheetUrl = new URL('../assets/codec/snake-sheet.png', import.meta.url).href;
const otaconSheetUrl = new URL('../assets/codec/otacon-sheet.png', import.meta.url).href;
const merylSheetUrl = new URL('../assets/codec/meryl-sheet.png', import.meta.url).href;
const colonelSheetUrl = new URL('../assets/codec/colonel-sheet.png', import.meta.url).href;

const spriteConfigs: Record<SpriteCharacterId, CharacterSpriteConfig> = {
  otacon: {
    sheetUrl: otaconSheetUrl,
    idleFrames: [0, 12, 18, 19],
    speakingFrames: [20, 21, 22, 23],
    portraitPreset: {
      zoom: 1.18,
      offsetY: -4,
    },
  },
  snake: {
    sheetUrl: snakeSheetUrl,
    excludedIndexes: [35, 36, 37, 40, 41],
    idleFrames: [0, 14, 18],
    speakingFrames: [8, 19, 29, 42, 44],
    portraitPreset: {
      zoom: 1.16,
      offsetX: -3,
      offsetY: -3,
    },
  },
  // Selected from the provided sheet by visual grouping after top-to-bottom / left-to-right extraction.
  // These favor the standard front-facing portrait row for idle and a more expressive lower row for talk.
  meryl: {
    sheetUrl: merylSheetUrl,
    idleFrames: [13, 18, 20],
    speakingFrames: [29, 30, 31, 32],
    portraitPreset: {
      zoom: 1.2,
      offsetY: -5,
    },
  },
  // Selected from the provided sheet by visual grouping after extraction.
  // The row around indexes 8-10 is the most expressive on the sheet, so it is used for talking.
  colonel: {
    sheetUrl: colonelSheetUrl,
    idleFrames: [0, 12, 18],
    speakingFrames: [8, 9, 10, 15],
    portraitPreset: {
      zoom: 1.22,
      offsetY: -6,
    },
  },
};

const sheetCache = new Map<SpriteCharacterId, Promise<SpriteSheetData>>();
const frameSetCache = new Map<string, Promise<ResolvedFrameSet>>();
const portraitControllers = new Map<HTMLCanvasElement, PortraitController>();
const spriteDebugState = new Map<SpriteCharacterId, CharacterDebugState>();
const spriteDebugLogged = new Set<SpriteCharacterId>();
let animationTimerId: number | null = null;
let animationTick = 0;

function ensureDebugState(characterId: SpriteCharacterId) {
  let debug = spriteDebugState.get(characterId);
  if (!debug) {
    debug = {
      extractedFrameCount: 0,
      fallbackUsed: false,
      idleResolvedIndexes: [],
      idleMissingIndexes: [],
      speakingResolvedIndexes: [],
      speakingMissingIndexes: [],
      spriteStatus: 'pending',
    };
    spriteDebugState.set(characterId, debug);
  }

  return debug;
}

function logDebugOnce(characterId: SpriteCharacterId) {
  if (!DEV_MODE || spriteDebugLogged.has(characterId)) {
    return;
  }

  const debug = spriteDebugState.get(characterId);
  if (!debug || debug.spriteStatus === 'pending') {
    return;
  }

  spriteDebugLogged.add(characterId);
  console.debug(`[codec-sprites] ${characterId}`, debug);
}

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
    throw new Error('Canvas 2D context unavailable for sprite extraction.');
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

  frames.sort((a, b) => {
    const rowDelta = Math.round(a.y / 12) - Math.round(b.y / 12);
    return rowDelta !== 0 ? rowDelta : a.x - b.x;
  });

  ensureDebugState(characterId).extractedFrameCount = frames.length;
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

function getFallbackIndexes(kind: FrameUsageKind, frames: FrameRect[]) {
  if (frames.length === 0) {
    return [];
  }

  if (kind === 'idle') {
    return [0];
  }

  const fallback = [0, 1, 2, 3].filter((index) => index < frames.length);
  return fallback.length > 0 ? fallback : [0];
}

function resolveFrameSet(characterId: SpriteCharacterId, kind: FrameUsageKind) {
  const cacheKey = `${characterId}:${kind}`;
  const cached = frameSetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const config = spriteConfigs[characterId];
  const requestedIndexes = kind === 'idle' ? config.idleFrames : config.speakingFrames;
  const excluded = new Set(config.excludedIndexes ?? []);

  const promise = getSpriteSheet(characterId).then(({ image, frames }) => {
    const usableFrames = frames.map((frame, index) => ({ frame, index })).filter(({ index }) => !excluded.has(index));
    const availableByIndex = new Map(usableFrames.map(({ frame, index }) => [index, frame]));
    const resolved = requestedIndexes
      .map((index) => availableByIndex.get(index) ? { index, frame: availableByIndex.get(index) as FrameRect } : null)
      .filter((entry): entry is { index: number; frame: FrameRect } => entry !== null);
    const missingRequestedIndexes = requestedIndexes.filter((index) => !availableByIndex.has(index));
    const desiredLength = Math.max(1, requestedIndexes.length);
    const fallbackPool = usableFrames.filter(({ index }) => !resolved.some((entry) => entry.index === index));
    const fallbackIndexes = getFallbackIndexes(kind, usableFrames.map(({ frame }) => frame));
    const fallbackResolved = (resolved.length === 0
      ? fallbackIndexes.map((index) => usableFrames[index] ?? null)
      : fallbackPool.slice(0, Math.max(0, desiredLength - resolved.length)))
      .filter((entry): entry is { index: number; frame: FrameRect } => entry !== null);
    const finalResolved = [...resolved, ...fallbackResolved].slice(0, desiredLength);

    if (finalResolved.length === 0) {
      throw new Error(`No usable codec sprite frames found for ${characterId}.`);
    }

    const debug = ensureDebugState(characterId);
    debug.fallbackUsed = debug.fallbackUsed || fallbackResolved.length > 0;
    if (kind === 'idle') {
      debug.idleResolvedIndexes = finalResolved.map(({ index }) => index);
      debug.idleMissingIndexes = missingRequestedIndexes;
    } else {
      debug.speakingResolvedIndexes = finalResolved.map(({ index }) => index);
      debug.speakingMissingIndexes = missingRequestedIndexes;
    }

    return {
      image,
      frames: finalResolved.map(({ frame }) => frame),
      resolvedIndexes: finalResolved.map(({ index }) => index),
      missingRequestedIndexes,
      usedFallbackIndexes: fallbackResolved.length > 0,
    };
  });

  frameSetCache.set(cacheKey, promise);
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

function getNextIdleDelay(characterId: SpriteCharacterId, cycle: number) {
  const offsets: Record<SpriteCharacterId, number> = {
    snake: 331,
    otacon: 613,
    meryl: 479,
    colonel: 757,
  };
  const range = IDLE_MAX_INTERVAL_MS - IDLE_MIN_INTERVAL_MS;
  return IDLE_MIN_INTERVAL_MS + ((cycle * 971) + offsets[characterId]) % range;
}

async function paintPortraitFrame(controller: PortraitController, now: number) {
  const frameSet = await resolveFrameSet(controller.characterId, controller.speaking ? 'speaking' : 'idle');

  if (controller.speaking) {
    const frame = frameSet.frames[0];
    drawFrame(controller.canvas, controller.characterId, frameSet.image, frame);
    return;
  }

  const idleFrame = frameSet.frames[0];
  if (now < controller.idleFrameShownUntil && frameSet.frames.length > 1) {
    const alternateIndex = (controller.idleFrameIndex % (frameSet.frames.length - 1)) + 1;
    const alternateFrame = frameSet.frames[alternateIndex] ?? idleFrame;
    drawFrame(controller.canvas, controller.characterId, frameSet.image, alternateFrame);
    return;
  }

  drawFrame(controller.canvas, controller.characterId, frameSet.image, idleFrame);

  if (frameSet.frames.length > 1 && now >= controller.nextIdleSwapAt) {
    controller.idleFrameIndex = (controller.idleFrameIndex + 1) % (frameSet.frames.length - 1);
    controller.idleFrameShownUntil = now + IDLE_ALT_FRAME_MS;
    controller.nextIdleSwapAt = now + getNextIdleDelay(controller.characterId, animationTick + controller.idleFrameIndex + 1);
  }
}

function startAnimationLoop() {
  if (animationTimerId !== null) {
    return;
  }

  animationTimerId = window.setInterval(() => {
    animationTick += 1;

    for (const [canvas, controller] of portraitControllers.entries()) {
      if (!canvas.isConnected) {
        portraitControllers.delete(canvas);
        continue;
      }

      void paintPortraitFrame(controller, Date.now()).catch(() => {
        portraitControllers.delete(canvas);
        const face = canvas.closest<HTMLElement>('.portrait-face');
        if (face) {
          face.classList.remove('sprite-ready');
          face.dataset.spriteStatus = 'failed';
          const debug = ensureDebugState(controller.characterId);
          debug.spriteStatus = 'failed';
          debug.fallbackUsed = true;
          if (DEV_MODE) {
            face.dataset.codecSpriteDebug = JSON.stringify(debug);
          }
          logDebugOnce(controller.characterId);
        }
      });
    }

    if (portraitControllers.size === 0 && animationTimerId !== null) {
      window.clearInterval(animationTimerId);
      animationTimerId = null;
    }
  }, TALK_FRAME_MS);
}

function parseCharacterId(value: string | undefined): SpriteCharacterId | null {
  if (value === 'snake' || value === 'otacon' || value === 'meryl' || value === 'colonel') {
    return value;
  }

  return null;
}

function setupPortraitCanvas(canvas: HTMLCanvasElement) {
  const face = canvas.closest<HTMLElement>('.portrait-face');
  if (!face) {
    return null;
  }

  const characterId = parseCharacterId(face.dataset.codecSpriteCharacter);
  if (!characterId) {
    return null;
  }

  const now = Date.now();
  const controller: PortraitController = {
    canvas,
    characterId,
    speaking: face.dataset.codecSpriteSpeaking === 'true',
    idleFrameIndex: 0,
    speakingFrameIndex: 0,
    idleFrameShownUntil: 0,
    nextIdleSwapAt: now + getNextIdleDelay(characterId, animationTick + 1),
  };

  portraitControllers.set(canvas, controller);
  return controller;
}

function updateFaceDebug(face: HTMLElement, characterId: SpriteCharacterId) {
  if (!DEV_MODE) {
    return;
  }

  face.dataset.codecSpriteDebug = JSON.stringify(ensureDebugState(characterId));
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

    const speaking = face.dataset.codecSpriteSpeaking === 'true';
    let controller: PortraitController | null | undefined = portraitControllers.get(canvas);
    if (!controller) {
      controller = setupPortraitCanvas(canvas);
    }

    if (!controller) {
      continue;
    }

    controller.characterId = characterId;
    controller.speaking = speaking;

    Promise.all([
      resolveFrameSet(characterId, 'idle'),
      resolveFrameSet(characterId, 'speaking'),
    ])
      .then(([idleFrameSet]) => {
        face.classList.add('sprite-ready');
        face.dataset.spriteStatus = 'ready';
        const debug = ensureDebugState(characterId);
        debug.spriteStatus = 'ready';
        updateFaceDebug(face, characterId);
        drawFrame(canvas, characterId, idleFrameSet.image, idleFrameSet.frames[0]);
        logDebugOnce(characterId);
        startAnimationLoop();
      })
      .catch(() => {
        portraitControllers.delete(canvas);
        face.classList.remove('sprite-ready');
        face.dataset.spriteStatus = 'failed';
        const debug = ensureDebugState(characterId);
        debug.spriteStatus = 'failed';
        debug.fallbackUsed = true;
        updateFaceDebug(face, characterId);
        logDebugOnce(characterId);
      });
  }
}

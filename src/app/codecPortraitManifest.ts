import type {
  CodecCharacterId,
  CodecPortraitFamily,
  CodecPortraitFrameKey,
  CodecPortraitFrameRect,
  CodecPortraitRuntimeFrameSlot,
  CodecPortraitSpecialFrameSlot,
} from './types';

type CodecPortraitCropPreset = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type CodecPortraitManifestFrame = {
  key: CodecPortraitFrameKey;
  rect: CodecPortraitFrameRect;
  indexHint: number | null;
};

type CodecPortraitRuntimeFamilyFrames = Record<CodecPortraitRuntimeFrameSlot, CodecPortraitManifestFrame>;

type CodecPortraitCharacterManifest = {
  characterId: CodecCharacterId;
  sheetUrl: string;
  webCrop: CodecPortraitCropPreset;
  glassCrop: CodecPortraitCropPreset;
  families: Record<CodecPortraitFamily, CodecPortraitRuntimeFamilyFrames>;
  blink: null;
  special: Partial<Record<CodecPortraitSpecialFrameSlot, CodecPortraitManifestFrame>>;
  glasses: {
    default: CodecPortraitFrameKey;
    alert: CodecPortraitFrameKey;
  };
};

const snakeSheetUrl = new URL('../web/assets/codec/snake-sheet.png', import.meta.url).href;
const otaconSheetUrl = new URL('../web/assets/codec/otacon-sheet.png', import.meta.url).href;
const merylSheetUrl = new URL('../web/assets/codec/meryl-sheet.png', import.meta.url).href;
const colonelSheetUrl = new URL('../web/assets/codec/colonel-sheet.png', import.meta.url).href;

function rect(x: number, y: number, width: number, height: number): CodecPortraitFrameRect {
  return { x, y, width, height };
}

function frame(
  key: CodecPortraitFrameKey,
  frameRect: CodecPortraitFrameRect,
  indexHint: number,
): CodecPortraitManifestFrame {
  return {
    key,
    rect: frameRect,
    indexHint,
  };
}

function cropPreset(zoom: number, offsetX = 0, offsetY = 0): CodecPortraitCropPreset {
  return { zoom, offsetX, offsetY };
}

export const CODEC_PORTRAIT_MANIFEST = {
  snake: {
    characterId: 'snake',
    sheetUrl: snakeSheetUrl,
    webCrop: cropPreset(1.16, -3, -3),
    glassCrop: cropPreset(1.16, -3, -3),
    families: {
      neutral: {
        idle: frame('snake.neutral.idle', rect(13, 33, 52, 89), 0),
        talk1: frame('snake.neutral.talk1', rect(73, 128, 52, 89), 6),
        talk2: frame('snake.neutral.talk2', rect(218, 128, 52, 89), 8),
      },
      alert: {
        idle: frame('snake.alert.idle', rect(73, 234, 52, 89), 12),
        talk1: frame('snake.alert.talk1', rect(218, 234, 52, 89), 14),
        talk2: frame('snake.alert.talk2', rect(278, 234, 52, 89), 15),
      },
    },
    blink: null,
    special: {
      helmet: frame('snake.special.helmet', rect(218, 627, 52, 89), 35),
    },
    glasses: {
      default: 'snake.neutral.idle',
      alert: 'snake.alert.idle',
    },
  },
  otacon: {
    characterId: 'otacon',
    sheetUrl: otaconSheetUrl,
    webCrop: cropPreset(1.18, 0, -4),
    glassCrop: cropPreset(1.18, 0, -4),
    families: {
      neutral: {
        idle: frame('otacon.neutral.idle', rect(13, 33, 52, 89), 0),
        talk1: frame('otacon.neutral.talk1', rect(73, 128, 52, 89), 6),
        talk2: frame('otacon.neutral.talk2', rect(278, 128, 52, 89), 8),
      },
      alert: {
        idle: frame('otacon.alert.idle', rect(218, 234, 52, 89), 13),
        talk1: frame('otacon.alert.talk1', rect(278, 329, 52, 89), 18),
        talk2: frame('otacon.alert.talk2', rect(338, 329, 52, 89), 19),
      },
    },
    blink: null,
    special: {
      closeup: frame('otacon.special.closeup', rect(9, 446, 52, 89), 20),
    },
    glasses: {
      default: 'otacon.neutral.idle',
      alert: 'otacon.alert.idle',
    },
  },
  meryl: {
    characterId: 'meryl',
    sheetUrl: merylSheetUrl,
    webCrop: cropPreset(1.2, 0, -5),
    glassCrop: cropPreset(1.2, 0, -5),
    families: {
      neutral: {
        idle: frame('meryl.neutral.idle', rect(277, 445, 52, 89), 18),
        talk1: frame('meryl.neutral.talk1', rect(277, 540, 52, 89), 22),
        talk2: frame('meryl.neutral.talk2', rect(337, 540, 52, 89), 23),
      },
      alert: {
        idle: frame('meryl.alert.idle', rect(277, 646, 52, 89), 28),
        talk1: frame('meryl.alert.talk1', rect(277, 741, 52, 89), 32),
        talk2: frame('meryl.alert.talk2', rect(337, 741, 52, 89), 33),
      },
    },
    blink: null,
    special: {
      masked: frame('meryl.special.masked', rect(355, 850, 52, 89), 40),
      profile: frame('meryl.special.profile', rect(178, 953, 52, 89), 44),
    },
    glasses: {
      default: 'meryl.neutral.idle',
      alert: 'meryl.alert.idle',
    },
  },
  colonel: {
    characterId: 'colonel',
    sheetUrl: colonelSheetUrl,
    webCrop: cropPreset(1.22, 0, -6),
    glassCrop: cropPreset(1.22, 0, -6),
    families: {
      neutral: {
        idle: frame('colonel.neutral.idle', rect(13, 33, 52, 89), 0),
        talk1: frame('colonel.neutral.talk1', rect(73, 128, 52, 89), 6),
        talk2: frame('colonel.neutral.talk2', rect(218, 128, 52, 89), 8),
      },
      alert: {
        idle: frame('colonel.alert.idle', rect(218, 234, 52, 89), 14),
        talk1: frame('colonel.alert.talk1', rect(278, 329, 52, 89), 19),
        talk2: frame('colonel.alert.talk2', rect(338, 329, 52, 89), 20),
      },
    },
    blink: null,
    special: {
      misc: frame('colonel.special.misc', rect(22, 442, 52, 89), 21),
    },
    glasses: {
      default: 'colonel.neutral.idle',
      alert: 'colonel.alert.idle',
    },
  },
} satisfies Record<CodecCharacterId, CodecPortraitCharacterManifest>;

const CODEC_PORTRAIT_FRAME_LOOKUP = new Map<CodecPortraitFrameKey, CodecPortraitManifestFrame>();

for (const characterManifest of Object.values(CODEC_PORTRAIT_MANIFEST)) {
  for (const familyFrames of Object.values(characterManifest.families)) {
    for (const portraitFrame of Object.values(familyFrames)) {
      CODEC_PORTRAIT_FRAME_LOOKUP.set(portraitFrame.key, portraitFrame);
    }
  }

  for (const portraitFrame of Object.values(characterManifest.special)) {
    if (portraitFrame) {
      CODEC_PORTRAIT_FRAME_LOOKUP.set(portraitFrame.key, portraitFrame);
    }
  }
}

export function getCodecPortraitManifest(characterId: CodecCharacterId) {
  return CODEC_PORTRAIT_MANIFEST[characterId];
}

export function getCodecPortraitFamilyFrames(
  characterId: CodecCharacterId,
  family: CodecPortraitFamily,
) {
  return CODEC_PORTRAIT_MANIFEST[characterId].families[family];
}

export function getCodecPortraitFamilyIdleFrame(
  characterId: CodecCharacterId,
  family: CodecPortraitFamily,
) {
  return getCodecPortraitFamilyFrames(characterId, family).idle;
}

export function getCodecPortraitRuntimeFrame(
  characterId: CodecCharacterId,
  family: CodecPortraitFamily,
  slot: CodecPortraitRuntimeFrameSlot,
) {
  return getCodecPortraitFamilyFrames(characterId, family)[slot];
}

export function getCodecPortraitFrameByKey(frameKey: CodecPortraitFrameKey | null | undefined) {
  if (!frameKey) {
    return null;
  }

  return CODEC_PORTRAIT_FRAME_LOOKUP.get(frameKey) ?? null;
}

export function getCodecPortraitFrameWithFallback(options: {
  characterId?: CodecCharacterId;
  family?: CodecPortraitFamily | null;
  frameKey?: CodecPortraitFrameKey | null;
}) {
  if (!options.characterId) {
    return null;
  }

  const requestedFrame = getCodecPortraitFrameByKey(options.frameKey);
  if (requestedFrame) {
    return requestedFrame;
  }

  const requestedFamily = options.family ?? 'neutral';
  return getCodecPortraitFamilyIdleFrame(options.characterId, requestedFamily)
    ?? getCodecPortraitFamilyIdleFrame(options.characterId, 'neutral');
}


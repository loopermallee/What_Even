import {
  getCodecPortraitFrameWithFallback,
  getCodecPortraitRuntimeFrame,
} from '../../app/codecPortraitManifest';
import type { CodecPortraitScene } from '../../app/codecPortraitState';
import type {
  CodecCharacterId,
  CodecPortraitFamily,
  CodecPortraitFrameKey,
  CodecPortraitFrameRect,
  CodecPortraitRuntimeFrameSlot,
  CodecTalkingMode,
  ScriptedTalkCadence,
} from '../../app/types';

type AnimatedPortraitSide = {
  characterId?: CodecCharacterId;
  expression: CodecPortraitScene['left']['expression'];
  family: CodecPortraitFamily;
  active: boolean;
  portraitState: 'idle' | 'speaking';
  frameKey: CodecPortraitFrameKey | null;
  frameRect: CodecPortraitFrameRect | null;
  usesManifestFrame: boolean;
};

export type CodecPortraitAnimationFrame = {
  talkingMode: CodecTalkingMode;
  activeSpeakerSide: CodecPortraitScene['activeSpeakerSide'];
  barBucket: number;
  left: AnimatedPortraitSide;
  right: AnimatedPortraitSide;
};

type TalkController = {
  signature: string | null;
  sequenceIndex: number;
  holdUntil: number;
};

type AnimatorOptions = {
  onUpdate?: (frame: CodecPortraitAnimationFrame) => void;
};

const TICK_MS = 48;
const SIGNAL_MIN_STEP_MS = 100;
const SIGNAL_MAX_STEP_MS = 145;
const TALK_SEQUENCE_BY_FAMILY: Record<CodecPortraitFamily, CodecPortraitRuntimeFrameSlot[]> = {
  neutral: ['idle', 'talk1', 'idle', 'talk2', 'idle'],
  alert: ['idle', 'talk1', 'idle', 'talk2', 'idle'],
};

function getNextSignalDelay() {
  return SIGNAL_MIN_STEP_MS + Math.floor(Math.random() * (SIGNAL_MAX_STEP_MS - SIGNAL_MIN_STEP_MS + 1));
}

function clampBarBucket(bucket: number) {
  return Math.max(0, Math.min(10, bucket));
}

function scriptedSignalBucket(base: number) {
  const swing = [-1, 0, 1, 1, 2][Math.floor(Math.random() * 5)] ?? 0;
  return clampBarBucket(Math.max(3, base + 1 + swing));
}

function liveAudioSignalBucket(base: number, activityLevel: number) {
  const quantized = Math.round(Math.max(0, Math.min(1, activityLevel)) * 6);
  return clampBarBucket(Math.max(2, Math.min(9, base - 1 + quantized)));
}

function sameRect(left: CodecPortraitFrameRect | null, right: CodecPortraitFrameRect | null) {
  return left?.x === right?.x
    && left?.y === right?.y
    && left?.width === right?.width
    && left?.height === right?.height;
}

function sameSide(left: AnimatedPortraitSide, right: AnimatedPortraitSide) {
  return left.characterId === right.characterId
    && left.expression === right.expression
    && left.family === right.family
    && left.active === right.active
    && left.portraitState === right.portraitState
    && left.frameKey === right.frameKey
    && sameRect(left.frameRect, right.frameRect)
    && left.usesManifestFrame === right.usesManifestFrame;
}

function sameFrame(left: CodecPortraitAnimationFrame, right: CodecPortraitAnimationFrame) {
  return left.talkingMode === right.talkingMode
    && left.activeSpeakerSide === right.activeSpeakerSide
    && left.barBucket === right.barBucket
    && sameSide(left.left, right.left)
    && sameSide(left.right, right.right);
}

function createEmptySide(): AnimatedPortraitSide {
  return {
    characterId: undefined,
    expression: 'idle',
    family: 'neutral',
    active: false,
    portraitState: 'idle',
    frameKey: null,
    frameRect: null,
    usesManifestFrame: false,
  };
}

function createTalkController(): TalkController {
  return {
    signature: null,
    sequenceIndex: 0,
    holdUntil: 0,
  };
}

function getCadenceWindowMs(cadence: ScriptedTalkCadence | undefined) {
  if (cadence === 'staccato') {
    return { pre: 48, post: 120, minStep: 82, maxStep: 104 };
  }
  if (cadence === 'urgent') {
    return { pre: 56, post: 136, minStep: 88, maxStep: 112 };
  }
  if (cadence === 'measured') {
    return { pre: 90, post: 190, minStep: 106, maxStep: 134 };
  }

  return { pre: 78, post: 160, minStep: 94, maxStep: 120 };
}

function getTalkSignature(side: CodecPortraitScene['left']) {
  return side.characterId ? `${side.characterId}:${side.family}` : null;
}

function frameKeyMatchesSceneSide(
  side: CodecPortraitScene['left'],
  frameKey: CodecPortraitFrameKey | null,
) {
  return Boolean(side.characterId && frameKey?.startsWith(`${side.characterId}.${side.family}.`));
}

function resolveSceneSideFrame(
  side: CodecPortraitScene['left'],
  frameKey: CodecPortraitFrameKey | null,
) {
  const resolvedFrame = getCodecPortraitFrameWithFallback({
    characterId: side.characterId,
    family: side.family,
    frameKey: frameKeyMatchesSceneSide(side, frameKey) ? frameKey : null,
  });

  return {
    frameKey: resolvedFrame?.key ?? null,
    frameRect: resolvedFrame?.rect ?? null,
    usesManifestFrame: Boolean(resolvedFrame),
  };
}

export class CodecPortraitAnimator {
  private readonly onUpdate: ((frame: CodecPortraitAnimationFrame) => void) | null;
  private scene: CodecPortraitScene | null = null;
  private timer: number | null = null;
  private nextTalkAt = 0;
  private nextSignalAt = 0;
  private readonly talk = {
    left: createTalkController(),
    right: createTalkController(),
  };
  private frame: CodecPortraitAnimationFrame = {
    talkingMode: 'silent',
    activeSpeakerSide: null,
    barBucket: 0,
    left: createEmptySide(),
    right: createEmptySide(),
  };

  constructor(options?: AnimatorOptions) {
    this.onUpdate = options?.onUpdate ?? null;
  }

  destroy() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  setScene(scene: CodecPortraitScene) {
    const previousTalkingMode = this.scene?.talkingMode ?? 'silent';
    const previousSpeakerSide = this.scene?.activeSpeakerSide ?? null;
    this.scene = scene;

    if (previousTalkingMode !== scene.talkingMode || previousSpeakerSide !== scene.activeSpeakerSide) {
      this.nextTalkAt = 0;
      this.nextSignalAt = 0;
      this.talk.left.holdUntil = Date.now() + getCadenceWindowMs(scene.currentLineMetadata?.cadence).pre;
      this.talk.right.holdUntil = this.talk.left.holdUntil;
    }

    const nextFrame: CodecPortraitAnimationFrame = {
      talkingMode: scene.talkingMode,
      activeSpeakerSide: scene.activeSpeakerSide,
      barBucket: scene.signalBarBase,
      left: this.buildSideFrame(
        scene.left,
        scene.activeSpeakerSide === 'left' && scene.talkingMode !== 'silent' ? 'speaking' : 'idle',
        scene.activeSpeakerSide === 'left' && scene.talkingMode !== 'silent' ? this.frame.left.frameKey : null,
      ),
      right: this.buildSideFrame(
        scene.right,
        scene.activeSpeakerSide === 'right' && scene.talkingMode !== 'silent' ? 'speaking' : 'idle',
        scene.activeSpeakerSide === 'right' && scene.talkingMode !== 'silent' ? this.frame.right.frameKey : null,
      ),
    };

    if (scene.talkingMode === 'silent') {
      nextFrame.barBucket = scene.signalBarBase;
    } else if (scene.talkingMode === 'live_audio') {
      nextFrame.barBucket = liveAudioSignalBucket(scene.signalBarBase, scene.listeningActivityLevel);
    } else {
      nextFrame.barBucket = scriptedSignalBucket(scene.signalBarBase);
    }

    if (!sameFrame(this.frame, nextFrame)) {
      this.frame = nextFrame;
      this.onUpdate?.(this.frame);
    }

    if (this.timer === null) {
      this.timer = window.setInterval(() => {
        this.tick();
      }, TICK_MS);
    }
  }

  getSnapshot() {
    return this.frame;
  }

  private buildSideFrame(
    side: CodecPortraitScene['left'],
    portraitState: 'idle' | 'speaking',
    frameKey: CodecPortraitFrameKey | null,
  ): AnimatedPortraitSide {
    const resolvedFrame = resolveSceneSideFrame(side, frameKey);
    return {
      characterId: side.characterId,
      expression: side.expression,
      family: side.family,
      active: side.active,
      portraitState,
      frameKey: resolvedFrame.frameKey,
      frameRect: resolvedFrame.frameRect,
      usesManifestFrame: resolvedFrame.usesManifestFrame,
    };
  }

  private tick() {
    if (!this.scene) {
      return;
    }

    const now = Date.now();
    let dirty = false;
    const talkingSide = this.scene.activeSpeakerSide;

    if (this.scene.talkingMode !== 'silent' && talkingSide && now >= this.nextTalkAt) {
      const cadence = getCadenceWindowMs(this.scene.currentLineMetadata?.cadence);
      dirty = this.advanceTalkFrame(talkingSide) || dirty;
      this.nextTalkAt = now + cadence.minStep + Math.floor(Math.random() * Math.max(1, cadence.maxStep - cadence.minStep));
    }

    if (this.scene.talkingMode !== 'silent' && now >= this.nextSignalAt) {
      this.frame = {
        ...this.frame,
        barBucket: this.scene.talkingMode === 'live_audio'
          ? liveAudioSignalBucket(this.scene.signalBarBase, this.scene.listeningActivityLevel)
          : scriptedSignalBucket(this.scene.signalBarBase),
      };
      this.nextSignalAt = now + getNextSignalDelay();
      dirty = true;
    }

    if (dirty) {
      this.onUpdate?.(this.frame);
    }
  }

  private advanceTalkFrame(side: 'left' | 'right') {
    if (!this.scene) {
      return false;
    }

    const sceneSide = this.scene[side];
    if (!sceneSide.characterId) {
      return false;
    }

    const controller = this.talk[side];
    const signature = getTalkSignature(sceneSide);
    if (controller.signature !== signature) {
      controller.signature = signature;
      controller.sequenceIndex = 0;
      controller.holdUntil = Date.now() + getCadenceWindowMs(this.scene.currentLineMetadata?.cadence).pre;
      return false;
    }

    const now = Date.now();
    if (now < controller.holdUntil) {
      return false;
    }

    const sequence = TALK_SEQUENCE_BY_FAMILY[sceneSide.family];
    const slot = sequence[controller.sequenceIndex % sequence.length] ?? 'idle';
    controller.sequenceIndex = (controller.sequenceIndex + 1) % sequence.length;
    const nextFrame = getCodecPortraitRuntimeFrame(sceneSide.characterId, sceneSide.family, slot);
    const nextSide = this.buildSideFrame(sceneSide, 'speaking', nextFrame.key);
    const currentSide = this.frame[side];

    if (sameSide(currentSide, nextSide)) {
      return false;
    }

    this.frame = {
      ...this.frame,
      [side]: nextSide,
    };
    if (slot === 'idle') {
      controller.holdUntil = Date.now() + getCadenceWindowMs(this.scene.currentLineMetadata?.cadence).post;
    }
    return true;
  }
}

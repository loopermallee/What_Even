import type { CodecPortraitScene } from '../../app/codecPortraitState';
import type { CodecBlinkState, CodecMouthFrame, CodecTalkingMode } from '../../app/types';

type AnimatedPortraitSide = {
  expression: CodecPortraitScene['left']['expression'];
  active: boolean;
  blink: CodecBlinkState;
  mouth: CodecMouthFrame;
};

export type CodecPortraitAnimationFrame = {
  talkingMode: CodecTalkingMode;
  activeSpeakerSide: CodecPortraitScene['activeSpeakerSide'];
  barBucket: number;
  left: AnimatedPortraitSide;
  right: AnimatedPortraitSide;
};

type BlinkController = {
  state: CodecBlinkState;
  nextBlinkAt: number;
  stepAt: number;
  sequenceIndex: number;
};

type AnimatorOptions = {
  onUpdate?: (frame: CodecPortraitAnimationFrame) => void;
};

const TICK_MS = 48;
const BLINK_SEQUENCE: CodecBlinkState[] = ['closing', 'closed', 'opening', 'open'];
const BLINK_STEP_MS = [55, 65, 55, 0];
const TALK_MIN_STEP_MS = 90;
const TALK_MAX_STEP_MS = 125;
const SIGNAL_MIN_STEP_MS = 100;
const SIGNAL_MAX_STEP_MS = 145;

function createBlinkController(now: number): BlinkController {
  return {
    state: 'open',
    nextBlinkAt: now + getNextBlinkDelay(),
    stepAt: 0,
    sequenceIndex: -1,
  };
}

function getNextBlinkDelay() {
  return 3000 + Math.floor(Math.random() * 5000);
}

function getNextTalkDelay() {
  return TALK_MIN_STEP_MS + Math.floor(Math.random() * (TALK_MAX_STEP_MS - TALK_MIN_STEP_MS + 1));
}

function getNextSignalDelay() {
  return SIGNAL_MIN_STEP_MS + Math.floor(Math.random() * (SIGNAL_MAX_STEP_MS - SIGNAL_MIN_STEP_MS + 1));
}

function clampBarBucket(bucket: number) {
  return Math.max(0, Math.min(10, bucket));
}

function chooseScriptedMouthFrame(previous: CodecMouthFrame, allowOpen: boolean): CodecMouthFrame {
  const roll = Math.random();
  if (!allowOpen) {
    return roll < 0.65 ? 'closed' : 'half';
  }

  if (previous === 'open') {
    return roll < 0.75 ? 'half' : 'closed';
  }

  if (previous === 'half') {
    if (roll < 0.45) {
      return 'closed';
    }
    if (roll < 0.72) {
      return 'half';
    }
    return 'open';
  }

  if (roll < 0.3) {
    return 'closed';
  }
  if (roll < 0.84) {
    return 'half';
  }
  return 'open';
}

function chooseLiveAudioMouthFrame(previous: CodecMouthFrame, activityLevel: number): CodecMouthFrame {
  const quantized = Math.max(0, Math.min(1, activityLevel));
  const openWeight = quantized >= 0.72 ? 0.34 : quantized >= 0.48 ? 0.18 : 0.08;
  const halfWeight = quantized >= 0.2 ? 0.58 : 0.32;
  const roll = Math.random();

  if (previous === 'open' && roll < 0.5) {
    return 'half';
  }

  if (roll < openWeight) {
    return 'open';
  }

  if (roll < openWeight + halfWeight) {
    return 'half';
  }

  return 'closed';
}

function scriptedSignalBucket(base: number) {
  const swing = [-1, 0, 1, 1, 2][Math.floor(Math.random() * 5)] ?? 0;
  return clampBarBucket(Math.max(3, base + 1 + swing));
}

function liveAudioSignalBucket(base: number, activityLevel: number) {
  const quantized = Math.round(Math.max(0, Math.min(1, activityLevel)) * 6);
  return clampBarBucket(Math.max(2, Math.min(9, base - 1 + quantized)));
}

function sameFrame(left: CodecPortraitAnimationFrame, right: CodecPortraitAnimationFrame) {
  return left.talkingMode === right.talkingMode
    && left.activeSpeakerSide === right.activeSpeakerSide
    && left.barBucket === right.barBucket
    && left.left.expression === right.left.expression
    && left.left.active === right.left.active
    && left.left.blink === right.left.blink
    && left.left.mouth === right.left.mouth
    && left.right.expression === right.right.expression
    && left.right.active === right.right.active
    && left.right.blink === right.right.blink
    && left.right.mouth === right.right.mouth;
}

export class CodecPortraitAnimator {
  private readonly onUpdate: ((frame: CodecPortraitAnimationFrame) => void) | null;
  private scene: CodecPortraitScene | null = null;
  private timer: number | null = null;
  private nextMouthAt = 0;
  private nextSignalAt = 0;
  private readonly blink = {
    left: createBlinkController(Date.now()),
    right: createBlinkController(Date.now()),
  };
  private frame: CodecPortraitAnimationFrame = {
    talkingMode: 'silent',
    activeSpeakerSide: null,
    barBucket: 0,
    left: {
      expression: 'idle',
      active: false,
      blink: 'open',
      mouth: 'closed',
    },
    right: {
      expression: 'stern',
      active: false,
      blink: 'open',
      mouth: 'closed',
    },
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
      this.nextMouthAt = 0;
      this.nextSignalAt = 0;
    }
    const nextFrame: CodecPortraitAnimationFrame = {
      talkingMode: scene.talkingMode,
      activeSpeakerSide: scene.activeSpeakerSide,
      barBucket: scene.signalBarBase,
      left: {
        expression: scene.left.expression,
        active: scene.left.active,
        blink: this.blink.left.state,
        mouth: scene.activeSpeakerSide === 'left' ? this.frame.left.mouth : 'closed',
      },
      right: {
        expression: scene.right.expression,
        active: scene.right.active,
        blink: this.blink.right.state,
        mouth: scene.activeSpeakerSide === 'right' ? this.frame.right.mouth : 'closed',
      },
    };

    if (scene.talkingMode === 'silent') {
      nextFrame.left.mouth = 'closed';
      nextFrame.right.mouth = 'closed';
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

  private tick() {
    if (!this.scene) {
      return;
    }

    const now = Date.now();
    let dirty = false;
    dirty = this.tickBlinkController('left', now) || dirty;
    dirty = this.tickBlinkController('right', now) || dirty;

    const talkingSide = this.scene.activeSpeakerSide;
    const isHumanSpeech = this.scene.currentRole !== 'system';
    if (this.scene.talkingMode === 'silent' || !talkingSide) {
      if (this.frame.left.mouth !== 'closed' || this.frame.right.mouth !== 'closed') {
        this.frame = {
          ...this.frame,
          talkingMode: 'silent',
          barBucket: this.scene.signalBarBase,
          left: { ...this.frame.left, mouth: 'closed' },
          right: { ...this.frame.right, mouth: 'closed' },
        };
        dirty = true;
      }
    } else {
      if (now >= this.nextMouthAt) {
        const previous = talkingSide === 'left' ? this.frame.left.mouth : this.frame.right.mouth;
        const nextMouth = this.scene.talkingMode === 'live_audio'
          ? chooseLiveAudioMouthFrame(previous, this.scene.listeningActivityLevel)
          : chooseScriptedMouthFrame(previous, isHumanSpeech);
        const leftMouth = talkingSide === 'left' ? nextMouth : 'closed';
        const rightMouth = talkingSide === 'right' ? nextMouth : 'closed';
        this.frame = {
          ...this.frame,
          talkingMode: this.scene.talkingMode,
          left: { ...this.frame.left, mouth: leftMouth },
          right: { ...this.frame.right, mouth: rightMouth },
        };
        this.nextMouthAt = now + getNextTalkDelay();
        dirty = true;
      }

      if (now >= this.nextSignalAt) {
        this.frame = {
          ...this.frame,
          barBucket: this.scene.talkingMode === 'live_audio'
            ? liveAudioSignalBucket(this.scene.signalBarBase, this.scene.listeningActivityLevel)
            : scriptedSignalBucket(this.scene.signalBarBase),
        };
        this.nextSignalAt = now + getNextSignalDelay();
        dirty = true;
      }
    }

    if (dirty) {
      this.onUpdate?.(this.frame);
    }
  }

  private tickBlinkController(side: 'left' | 'right', now: number) {
    const controller = this.blink[side];
    if (controller.sequenceIndex === -1 && now >= controller.nextBlinkAt) {
      controller.sequenceIndex = 0;
      controller.state = BLINK_SEQUENCE[0];
      controller.stepAt = now + BLINK_STEP_MS[0];
      this.setBlinkState(side, controller.state);
      return true;
    }

    if (controller.sequenceIndex === -1 || now < controller.stepAt) {
      return false;
    }

    controller.sequenceIndex += 1;
    const nextState = BLINK_SEQUENCE[controller.sequenceIndex] ?? 'open';
    controller.state = nextState;
    if (nextState === 'open') {
      controller.sequenceIndex = -1;
      controller.nextBlinkAt = now + getNextBlinkDelay();
      controller.stepAt = 0;
    } else {
      controller.stepAt = now + (BLINK_STEP_MS[controller.sequenceIndex] ?? 0);
    }

    this.setBlinkState(side, nextState);
    return true;
  }

  private setBlinkState(side: 'left' | 'right', blink: CodecBlinkState) {
    if (side === 'left' && this.frame.left.blink !== blink) {
      this.frame = {
        ...this.frame,
        left: { ...this.frame.left, blink },
      };
      return;
    }

    if (side === 'right' && this.frame.right.blink !== blink) {
      this.frame = {
        ...this.frame,
        right: { ...this.frame.right, blink },
      };
    }
  }
}

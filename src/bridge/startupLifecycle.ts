import type { DevicePageLifecycleState } from '../app/types';

export type BridgePagePayload = {
  containerTotalNum?: number;
  listObject?: Array<{
    containerID?: number;
    containerName?: string;
    xPosition?: number;
    yPosition?: number;
    width?: number;
    height?: number;
    isEventCapture?: number;
    itemContainer?: {
      itemCount?: number;
      itemName?: string[];
      itemWidth?: number;
      isItemSelectBorderEn?: number;
    };
  }>;
  textObject?: Array<{
    containerID?: number;
    containerName?: string;
    xPosition?: number;
    yPosition?: number;
    width?: number;
    height?: number;
    isEventCapture?: number;
    content?: string;
  }>;
  imageObject?: Array<{
    containerID?: number;
    containerName?: string;
    xPosition?: number;
    yPosition?: number;
    width?: number;
    height?: number;
  }>;
};

export type StartupLifecycleEnsureResult = {
  ok: boolean;
  activeStateWasHint: boolean;
};

type BridgeLike = {
  createStartUpPageContainer: (payload: any) => Promise<unknown>;
  rebuildPageContainer: (payload: any) => Promise<unknown>;
  shutDownPageContainer: (id: number) => Promise<unknown>;
};

type Logger = (message: string) => void;

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function toBridgePayload(payload: BridgePagePayload): BridgePagePayload {
  return {
    containerTotalNum: payload.containerTotalNum,
    listObject: (payload.listObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
      borderWidth: (item as { borderWidth?: number }).borderWidth,
      borderColor: (item as { borderColor?: number }).borderColor,
      borderRadius: (item as { borderRadius?: number }).borderRadius,
      paddingLength: (item as { paddingLength?: number }).paddingLength,
      isEventCapture: item.isEventCapture,
      itemContainer: item.itemContainer
        ? {
          itemCount: item.itemContainer.itemCount,
          itemWidth: item.itemContainer.itemWidth,
          isItemSelectBorderEn: item.itemContainer.isItemSelectBorderEn,
          itemName: item.itemContainer.itemName,
        }
        : undefined,
    })),
    textObject: (payload.textObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
      borderWidth: (item as { borderWidth?: number }).borderWidth,
      borderColor: (item as { borderColor?: number }).borderColor,
      borderRadius: (item as { borderRadius?: number }).borderRadius,
      paddingLength: (item as { paddingLength?: number }).paddingLength,
      isEventCapture: item.isEventCapture,
      content: item.content,
    })),
    imageObject: (payload.imageObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
    })),
  };
}

function describeBridgePayload(payload: BridgePagePayload) {
  return {
    containerTotalNum: payload.containerTotalNum ?? null,
    listObject: (payload.listObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
      isEventCapture: item.isEventCapture ?? 0,
      itemContainer: item.itemContainer
        ? {
          itemCount: item.itemContainer.itemCount,
          itemWidth: item.itemContainer.itemWidth,
          isItemSelectBorderEn: item.itemContainer.isItemSelectBorderEn,
          itemName: item.itemContainer.itemName,
        }
        : undefined,
    })),
    textObject: (payload.textObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
      isEventCapture: item.isEventCapture ?? 0,
      content: item.content,
    })),
    imageObject: (payload.imageObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
    })),
  };
}

function getDebugPayloadMeta(payload: BridgePagePayload) {
  const captureText = (payload.textObject ?? []).find((item) => item.isEventCapture === 1)?.containerName ?? null;
  const captureList = (payload.listObject ?? []).find((item) => item.isEventCapture === 1)?.containerName ?? null;
  const captureContainer = captureText ?? captureList ?? 'none';

  return {
    captureContainer,
    textContainerNames: (payload.textObject ?? []).map((item) => item.containerName),
    listContainerNames: (payload.listObject ?? []).map((item) => item.containerName),
    imageContainerNames: (payload.imageObject ?? []).map((item) => item.containerName),
  };
}

function validateRebuildPayload(payload: BridgePagePayload) {
  const errors: string[] = [];
  const canvasWidth = 576;
  const canvasHeight = 288;
  const textObject = payload.textObject ?? [];
  const imageObject = payload.imageObject ?? [];
  const listObject = payload.listObject ?? [];
  const allContainers = [...textObject, ...imageObject, ...listObject];

  const actualCount = allContainers.length;
  if ((payload.containerTotalNum ?? -1) !== actualCount) {
    errors.push(`containerTotalNum=${payload.containerTotalNum ?? 'unset'} but actualCount=${actualCount}`);
  }

  const idSet = new Set<number>();
  const nameSet = new Set<string>();
  let captureCount = 0;

  const validateBounds = (
    kind: 'text' | 'image' | 'list',
    containerName: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    if (x < 0 || y < 0) {
      errors.push(`${kind} container ${containerName} has negative position (${x},${y})`);
    }

    if (x > canvasWidth || y > canvasHeight) {
      errors.push(`${kind} container ${containerName} position out of canvas (${x},${y})`);
    }

    if (x + width > canvasWidth) {
      errors.push(`${kind} container ${containerName} exceeds canvas width: x+width=${x + width} > ${canvasWidth}`);
    }

    if (y + height > canvasHeight) {
      errors.push(`${kind} container ${containerName} exceeds canvas height: y+height=${y + height} > ${canvasHeight}`);
    }
  };

  for (const item of textObject) {
    const containerName = item.containerName ?? '<unnamed>';
    const containerID = item.containerID ?? -1;
    const x = item.xPosition ?? -1;
    const y = item.yPosition ?? -1;
    const width = item.width ?? -1;
    const height = item.height ?? -1;

    if (idSet.has(containerID)) {
      errors.push(`duplicate containerID=${containerID}`);
    } else {
      idSet.add(containerID);
    }

    if (nameSet.has(containerName)) {
      errors.push(`duplicate containerName=${containerName}`);
    } else {
      nameSet.add(containerName);
    }

    if (containerName.length > 16) {
      errors.push(`containerName ${containerName} length=${containerName.length} exceeds max 16`);
    }

    if (width <= 0 || height <= 0) {
      errors.push(`text container ${containerName} has invalid size width=${width} height=${height}`);
    }

    if (item.isEventCapture === 1) {
      captureCount += 1;
    }

    validateBounds('text', containerName, x, y, width, height);
  }

  for (const item of imageObject) {
    const containerName = item.containerName ?? '<unnamed>';
    const containerID = item.containerID ?? -1;
    const x = item.xPosition ?? -1;
    const y = item.yPosition ?? -1;
    const width = item.width ?? -1;
    const height = item.height ?? -1;

    if (idSet.has(containerID)) {
      errors.push(`duplicate containerID=${containerID}`);
    } else {
      idSet.add(containerID);
    }

    if (nameSet.has(containerName)) {
      errors.push(`duplicate containerName=${containerName}`);
    } else {
      nameSet.add(containerName);
    }

    if (containerName.length > 16) {
      errors.push(`containerName ${containerName} length=${containerName.length} exceeds max 16`);
    }

    if (width < 20 || width > 288) {
      errors.push(`image container ${containerName} width=${width} outside SDK range 20-288`);
    }

    if (height < 20 || height > 144) {
      errors.push(`image container ${containerName} height=${height} outside SDK range 20-144`);
    }

    validateBounds('image', containerName, x, y, width, height);
  }

  for (const item of listObject) {
    const containerName = item.containerName ?? '<unnamed>';
    const containerID = item.containerID ?? -1;
    const x = item.xPosition ?? -1;
    const y = item.yPosition ?? -1;
    const width = item.width ?? -1;
    const height = item.height ?? -1;

    if (idSet.has(containerID)) {
      errors.push(`duplicate containerID=${containerID}`);
    } else {
      idSet.add(containerID);
    }

    if (nameSet.has(containerName)) {
      errors.push(`duplicate containerName=${containerName}`);
    } else {
      nameSet.add(containerName);
    }

    if (containerName.length > 16) {
      errors.push(`containerName ${containerName} length=${containerName.length} exceeds max 16`);
    }

    if (item.isEventCapture === 1) {
      captureCount += 1;
    }

    validateBounds('list', containerName, x, y, width, height);
  }

  if (captureCount !== 1) {
    errors.push(`captureCount=${captureCount} but expected exactly 1`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export class StartupLifecycleManager {
  private readonly bridge: BridgeLike;
  private readonly log: Logger;
  private readonly getLifecycleState: () => DevicePageLifecycleState;
  private readonly setLifecycleState: (value: DevicePageLifecycleState) => void;

  constructor(options: {
    bridge: BridgeLike;
    log: Logger;
    getLifecycleState: () => DevicePageLifecycleState;
    setLifecycleState: (value: DevicePageLifecycleState) => void;
  }) {
    this.bridge = options.bridge;
    this.log = options.log;
    this.getLifecycleState = options.getLifecycleState;
    this.setLifecycleState = options.setLifecycleState;
  }

  async attemptRebuild(label: string, payload: BridgePagePayload) {
    const bridgePayload = toBridgePayload(payload);
    this.log(`Rebuild attempt (${label}) exact payload: ${safeSerialize(bridgePayload)}`);
    this.log(`Rebuild attempt (${label}) debug meta: ${safeSerialize(getDebugPayloadMeta(payload))}`);
    const validation = validateRebuildPayload(payload);

    if (!validation.valid) {
      this.log(`Rebuild skipped due to invalid payload (${label}).`);
      for (const error of validation.errors) {
        this.log(`Validation error: ${error}`);
      }
      return false;
    }

    const rebuilt = Boolean(await this.bridge.rebuildPageContainer(bridgePayload as any));
    this.log(`rebuild result (${label}): ${String(rebuilt)}`);
    if (rebuilt) {
      this.log(`rebuild accepted by bridge (${label}); visual render verification still pending.`);
      this.setLifecycleState('active');
      return true;
    }

    this.log(`Rebuild failed after local validation passed (${label}).`);
    this.log(`Attempted bridge payload (${label}): ${safeSerialize(describeBridgePayload(bridgePayload))}`);
    return false;
  }

  async attemptStartupCreate(label: string, payload: BridgePagePayload) {
    this.log(`Startup create attempt (${label}) exact payload: ${safeSerialize(payload)}`);
    this.log(`Startup create attempt (${label}) debug meta: ${safeSerialize(getDebugPayloadMeta(payload))}`);
    const result = Number(await this.bridge.createStartUpPageContainer(payload as any));
    this.log(`startup create exact result code (${label}): ${result}`);
    return result;
  }

  async shutdown(label: string) {
    this.log(`shutting down old page before creating/updating (${label})`);
    const result = Number(await this.bridge.shutDownPageContainer(0));
    this.log(`shutdown result (${label}): ${String(result)}`);
    this.setLifecycleState('inactive');
    return result;
  }

  async waitAfterShutdown(ms = 140) {
    await delay(ms);
  }

  async ensureStartupPageLifecycle(options: {
    forceReset: boolean;
    minimalStartPayload: BridgePagePayload;
  }): Promise<StartupLifecycleEnsureResult> {
    if (options.forceReset) {
      this.log('startup page reset requested');
      await this.shutdown('dev-reset');
      await this.waitAfterShutdown();
      const startupCreateResult = await this.attemptStartupCreate(
        'dev-reset:minimal-two-text',
        options.minimalStartPayload
      );

      if (startupCreateResult === 0) {
        this.setLifecycleState('active');
        this.log('startup lifecycle: fallback/rebuild skipped=false after reset create success.');
        return { ok: true, activeStateWasHint: false };
      }

      this.log('startup create failed after reset request');
      if (startupCreateResult === 2) {
        this.log('Result 2 = oversize request.');
      } else if (startupCreateResult === 3) {
        this.log('Result 3 = out of memory.');
      } else if (startupCreateResult === 1) {
        this.log('Result 1 = invalid request.');
      }

      return { ok: false, activeStateWasHint: false };
    }

    if (this.getLifecycleState() === 'active') {
      this.log('startup lifecycle: active page detected, skipping startup create and using rebuild.');
      this.log('startup lifecycle: fallback/rebuild skipped=false because active lifecycle hint allows rebuild path.');
      return { ok: true, activeStateWasHint: true };
    }

    this.log('startup lifecycle: creating startup page for first launch.');
    const startupCreateResult = await this.attemptStartupCreate('first-launch:minimal-two-text', options.minimalStartPayload);

    if (startupCreateResult === 0) {
      this.setLifecycleState('active');
      this.log('startup lifecycle: fallback/rebuild skipped=false after first-launch create success.');
      return { ok: true, activeStateWasHint: false };
    }

    if (startupCreateResult === 1) {
      this.log('startup lifecycle: create returned invalid; treating as hard invalid-parameter failure.');
      this.log('startup lifecycle: fallback/rebuild skipped=true because startup create failed.');
      this.setLifecycleState('unknown');
      return { ok: false, activeStateWasHint: false };
    }

    if (startupCreateResult === 2) {
      this.log('Result 2 = oversize request.');
    } else if (startupCreateResult === 3) {
      this.log('Result 3 = out of memory.');
    }

    this.log('startup create failed in first-launch flow');
    this.log('startup lifecycle: fallback/rebuild skipped=true because startup create failed.');
    return { ok: false, activeStateWasHint: false };
  }
}

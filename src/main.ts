import './style.css';
import {
  ImageRawDataUpdateResult,
  OsEventTypeList,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { CodecGlassesController } from './codecGlassesController';
import { getCodecAssetBytes, type CodecAssetKey } from './codecGlassesAssets';
import {
  InteractionFeedbackManager,
  type InteractionFeedbackItem,
  type RawInteractionType,
} from './interaction-feedback';

type SpeakerSide = 'left' | 'right';

type DialogueLine = {
  speaker: SpeakerSide;
  text: string;
};

type Contact = {
  name: string;
  code: string;
  frequency: string;
  portraitTag: string;
  dialogue: DialogueLine[];
};

const RIGHT_CHARACTER = {
  name: 'Snake',
  code: 'SNAKE',
  portraitTag: 'SN',
};

const contacts: Contact[] = [
  {
    name: 'Colonel',
    code: 'CMD',
    frequency: '140.85',
    portraitTag: 'CO',
    dialogue: [
      { speaker: 'left', text: 'Snake, codec check. Your signal is stable now.' },
      { speaker: 'right', text: 'I read you. What is the situation?' },
      { speaker: 'left', text: 'Stay low, move carefully, and avoid drawing attention.' },
      { speaker: 'right', text: 'Understood. I will move once the path is clear.' },
    ],
  },
  {
    name: 'Otacon',
    code: 'ENG',
    frequency: '141.12',
    portraitTag: 'OT',
    dialogue: [
      { speaker: 'left', text: 'Snake, I can keep an eye on the system feed from here.' },
      { speaker: 'right', text: 'Good. Let me know if anything changes.' },
      { speaker: 'left', text: 'If the patrol route shifts, I will call it out immediately.' },
      { speaker: 'right', text: 'That is all I need. Stay sharp.' },
    ],
  },
  {
    name: 'Meryl',
    code: 'ALY',
    frequency: '140.15',
    portraitTag: 'MR',
    dialogue: [
      { speaker: 'left', text: 'Snake, I am in position. The route ahead is still open.' },
      { speaker: 'right', text: 'Good. Keep your head down and do not rush it.' },
      { speaker: 'left', text: 'Relax. I know what I am doing.' },
      { speaker: 'right', text: 'Fine. Just stay on comms.' },
    ],
  },
];

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root element');
}

const devResetButtonHtml = import.meta.env.DEV
  ? '<button id="resetStartupBtn">Reset Glasses UI</button>'
  : '';

app.innerHTML = `
  <div class="wrap">
    <h1>What Even</h1>
    <p class="subtitle">Codec-style prototype</p>

    <div class="controls-card">
      <div class="controls-row">
        <button id="startEvenBtn">Start on Even</button>
        <button id="prevContactBtn" disabled>Prev Contact</button>
        <button id="nextContactBtn" disabled>Next Contact</button>
        <button id="startCallBtn" disabled>Start Call</button>
        <button id="nextLineBtn" disabled>Next Line</button>
        <button id="endCallBtn" disabled>End Call</button>
        ${devResetButtonHtml}
        <button id="copyLogBtn">Copy Log</button>
        <button id="clearLogBtn">Clear Log</button>
      </div>
    </div>

    <div id="codecMount"></div>

    <div class="log-card">
      <div class="log-header">
        <span>Log</span>
      </div>
      <pre id="log" class="log"></pre>
    </div>
  </div>
`;

function mustQuery<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

const startEvenBtn = mustQuery<HTMLButtonElement>('#startEvenBtn');
const prevContactBtn = mustQuery<HTMLButtonElement>('#prevContactBtn');
const nextContactBtn = mustQuery<HTMLButtonElement>('#nextContactBtn');
const startCallBtn = mustQuery<HTMLButtonElement>('#startCallBtn');
const nextLineBtn = mustQuery<HTMLButtonElement>('#nextLineBtn');
const endCallBtn = mustQuery<HTMLButtonElement>('#endCallBtn');
const resetStartupBtn = document.querySelector<HTMLButtonElement>('#resetStartupBtn');
const copyLogBtn = mustQuery<HTMLButtonElement>('#copyLogBtn');
const clearLogBtn = mustQuery<HTMLButtonElement>('#clearLogBtn');
const codecMount = mustQuery<HTMLDivElement>('#codecMount');
const logEl = mustQuery<HTMLPreElement>('#log');

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null;
let hasStarted = false;
let currentContactIndex = 0;
let callActive = false;
let currentLineIndex = -1;
let mouthOpen = false;
let barLevel = 0;
let displayedDialogueText = '';
let typingInProgress = false;
let typingTimer: number | null = null;
let speakingTimer: number | null = null;
let unsubscribeEvenHubEvents: (() => void) | null = null;
let feedbackManager: InteractionFeedbackManager | null = null;
let glassesSyncTimer: number | null = null;
const activeFeedbackItems = new Map<number, InteractionFeedbackItem>();

const DEBUG_INTERACTION = false;

const INTERACTION_LABELS: Record<RawInteractionType, string> = {
  up: 'UP',
  down: 'DOWN',
  click: 'TAP',
  double_click: 'DOUBLE TAP',
};

const GLASSES_CONTAINERS = {
  portraitImage: { id: 101, name: 'codec-face' },
  dialogueText: { id: 102, name: 'codec-dialog' },
  statusText: { id: 103, name: 'codec-status' },
} as const;

const STARTUP_DIALOGUE_CONTENT = ['140.85', 'OTACON', 'Incoming Codec', 'Tap to answer'].join('\n');
const STARTUP_ACTION_CONTENT = '> Answer\nIgnore';

type EventBranchSource = 'listEvent' | 'textEvent' | 'sysEvent' | 'unknown';

type NormalizedInput = 'UP' | 'DOWN' | 'TAP' | 'DOUBLE_TAP' | 'AT_TOP' | 'AT_BOTTOM';

type InputInspection = {
  source: EventBranchSource;
  rawEventType: unknown;
  rawEventTypeName: string;
  normalizedTypeToken: string;
  containerID: number | null;
  containerName: string | null;
  currentSelectItemName: string | null;
  currentSelectItemIndex: number | null;
  eventTypeCandidates: string[];
};

type DevicePageLifecycleState = 'unknown' | 'active' | 'inactive';
const DEVICE_PAGE_LIFECYCLE_KEY = 'what-even:device-page-lifecycle';
let hasLoggedUnknownEventDump = false;
const lastListIndexByContainer = new Map<string, number>();
const glassesCodec = new CodecGlassesController();
let lastRenderedPortraitAsset: CodecAssetKey | null = null;
let imageUpdateQueue = Promise.resolve();
let devicePageLifecycleState: DevicePageLifecycleState = readDevicePageLifecycleState();

function log(message: string) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function getCurrentContact() {
  return contacts[currentContactIndex];
}

function getCurrentLine() {
  if (!callActive || currentLineIndex < 0) {
    return null;
  }

  return getCurrentContact().dialogue[currentLineIndex] ?? null;
}

function debugInteractionLog(message: string) {
  if (!DEBUG_INTERACTION) {
    return;
  }

  log(`[interaction-debug] ${message}`);
}

function writeDevicePageLifecycleState(value: DevicePageLifecycleState) {
  devicePageLifecycleState = value;
  try {
    localStorage.setItem(DEVICE_PAGE_LIFECYCLE_KEY, value);
  } catch {
    // no-op: storage may be unavailable in some webview environments
  }
}

function readDevicePageLifecycleState(): DevicePageLifecycleState {
  try {
    const value = localStorage.getItem(DEVICE_PAGE_LIFECYCLE_KEY);
    if (value === 'active' || value === 'inactive' || value === 'unknown') {
      return value;
    }
  } catch {
    // no-op: storage may be unavailable in some webview environments
  }

  return 'unknown';
}

function getLatestFeedback() {
  return Array.from(activeFeedbackItems.values()).sort((a, b) => b.id - a.id)[0] ?? null;
}

function getCurrentInteractionLabel() {
  const latest = getLatestFeedback();
  if (!latest) {
    return null;
  }

  return INTERACTION_LABELS[latest.interaction];
}

function isConversationFinished() {
  const contact = getCurrentContact();
  return callActive && currentLineIndex >= contact.dialogue.length - 1;
}

function getSpeakerName(side: SpeakerSide) {
  return side === 'left' ? getCurrentContact().name : RIGHT_CHARACTER.name;
}

function getGlassesDialogueText() {
  return STARTUP_DIALOGUE_CONTENT;
}

function getGlassesStatusText() {
  const view = glassesCodec.getViewModel();
  if (view.screen === 'incoming') {
    return buildIncomingActionText(view.status);
  }

  return STARTUP_ACTION_CONTENT;
}

function buildIncomingActionText(status: string) {
  const choices = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('ANSWER') || line.includes('IGNORE'))
    .slice(0, 2)
    .map((line) => {
      const selected = line.startsWith('>');
      const cleaned = line.replace(/^>?\s*/, '').toLowerCase();
      const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return selected ? `> ${title}` : title;
    });

  if (choices.length === 2) {
    return choices.join('\n');
  }

  return STARTUP_ACTION_CONTENT;
}

type BridgePagePayload = {
  containerTotalNum?: number;
  listObject?: Array<{
    containerID?: number;
    containerName?: string;
    xPosition?: number;
    yPosition?: number;
    width?: number;
    height?: number;
    isEventCapture?: number;
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

function buildDialogueContainer(content: string) {
  return {
    xPosition: 132,
    yPosition: 38,
    width: 238,
    height: 126,
    containerID: GLASSES_CONTAINERS.dialogueText.id,
    containerName: GLASSES_CONTAINERS.dialogueText.name,
    content,
    isEventCapture: 0,
  };
}

function buildMinimalStartupCaptureTextContainer(content: string) {
  return {
    xPosition: 132,
    yPosition: 182,
    width: 190,
    height: 72,
    containerID: GLASSES_CONTAINERS.statusText.id,
    containerName: GLASSES_CONTAINERS.statusText.name,
    content,
    isEventCapture: 1,
  };
}

function buildStatusContainer(content: string) {
  return {
    xPosition: 132,
    yPosition: 182,
    width: 190,
    height: 72,
    containerID: GLASSES_CONTAINERS.statusText.id,
    containerName: GLASSES_CONTAINERS.statusText.name,
    content,
    isEventCapture: 1,
  };
}

function buildPortraitImageContainer() {
  return {
    xPosition: 22,
    yPosition: 42,
    width: 96,
    height: 96,
    containerID: GLASSES_CONTAINERS.portraitImage.id,
    containerName: GLASSES_CONTAINERS.portraitImage.name,
  };
}

function buildStartContainer(): BridgePagePayload {
  return {
    containerTotalNum: 3,
    imageObject: [buildPortraitImageContainer()],
    textObject: [
      buildDialogueContainer(STARTUP_DIALOGUE_CONTENT),
      buildStatusContainer(STARTUP_ACTION_CONTENT),
    ],
  };
}

function buildMinimalStartContainer(): BridgePagePayload {
  return {
    containerTotalNum: 1,
    textObject: [buildMinimalStartupCaptureTextContainer(STARTUP_ACTION_CONTENT)],
  };
}

function buildTextOnlyRebuildContainer(): BridgePagePayload {
  return {
    containerTotalNum: 2,
    textObject: [
      buildDialogueContainer(STARTUP_DIALOGUE_CONTENT),
      buildStatusContainer(STARTUP_ACTION_CONTENT),
    ],
  };
}

function buildRebuildContainer(): BridgePagePayload {
  return {
    containerTotalNum: 3,
    imageObject: [buildPortraitImageContainer()],
    textObject: [
      buildDialogueContainer(STARTUP_DIALOGUE_CONTENT),
      buildStatusContainer(STARTUP_ACTION_CONTENT),
    ],
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
  const captureContainer = (payload.textObject ?? []).find((item) => item.isEventCapture === 1)?.containerName ?? 'none';
  return {
    captureContainer,
    textContainerNames: (payload.textObject ?? []).map((item) => item.containerName),
    imageContainerNames: (payload.imageObject ?? []).map((item) => item.containerName),
  };
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
      isEventCapture: item.isEventCapture,
    })),
    textObject: (payload.textObject ?? []).map((item) => ({
      containerID: item.containerID,
      containerName: item.containerName,
      xPosition: item.xPosition,
      yPosition: item.yPosition,
      width: item.width,
      height: item.height,
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

    if (width < 20 || width > 200) {
      errors.push(`image container ${containerName} width=${width} outside SDK range 20-200`);
    }

    if (height < 20 || height > 100) {
      errors.push(`image container ${containerName} height=${height} outside SDK range 20-100`);
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

async function attemptRebuild(
  label: string,
  payload: BridgePagePayload
) {
  if (!bridge) {
    return false;
  }

  const bridgePayload = toBridgePayload(payload);
  log(`Rebuild attempt (${label}) bridge payload: ${safeSerialize(describeBridgePayload(bridgePayload))}`);
  log(`Rebuild attempt (${label}) debug meta: ${safeSerialize(getDebugPayloadMeta(payload))}`);
  const validation = validateRebuildPayload(payload);

  if (!validation.valid) {
    log(`Rebuild skipped due to invalid payload (${label}).`);
    for (const error of validation.errors) {
      log(`Validation error: ${error}`);
    }
    return false;
  }

  const rebuilt = await bridge.rebuildPageContainer(bridgePayload as any);
  log(`rebuild result (${label}): ${String(rebuilt)}`);
  if (rebuilt) {
    writeDevicePageLifecycleState('active');
    return true;
  }

  log(`Rebuild failed after local validation passed (${label}).`);
  log(`Attempted bridge payload (${label}): ${safeSerialize(describeBridgePayload(bridgePayload))}`);
  return false;
}

async function attemptStartupCreate(
  label: string,
  payload: BridgePagePayload
) {
  if (!bridge) {
    return -1;
  }

  const bridgePayload = toBridgePayload(payload);
  log(`Startup create attempt (${label}) bridge payload: ${safeSerialize(describeBridgePayload(bridgePayload))}`);
  log(`Startup create attempt (${label}) debug meta: ${safeSerialize(getDebugPayloadMeta(payload))}`);
  const result = await bridge.createStartUpPageContainer(bridgePayload as any);
  log(`startup create result (${label}): ${result}`);
  return result;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function shutdownGlassesPage(label: string) {
  if (!bridge) {
    return null;
  }

  log(`shutting down old page before creating/updating (${label})`);
  const result = await bridge.shutDownPageContainer(0);
  log(`shutdown result (${label}): ${String(result)}`);
  writeDevicePageLifecycleState('inactive');
  hasStarted = false;
  return result;
}

async function resetGlassesPageAndCreateStartup() {
  if (!bridge) {
    return false;
  }

  log('startup page reset requested');
  await shutdownGlassesPage('dev-reset');
  await delay(140);
  const startupCreateResult = await attemptStartupCreate(
    'dev-reset:minimal-single-text',
    buildMinimalStartContainer()
  );

  if (startupCreateResult === 0) {
    writeDevicePageLifecycleState('active');
    return true;
  }

  log('startup create failed after reset request');
  if (startupCreateResult === 2) {
    log('Result 2 = oversize request.');
  } else if (startupCreateResult === 3) {
    log('Result 3 = out of memory.');
  } else if (startupCreateResult === 1) {
    log('Result 1 = invalid request.');
  }

  return false;
}

async function ensureStartupPageLifecycle(options: { forceReset: boolean }) {
  if (!bridge) {
    return false;
  }

  if (options.forceReset) {
    return resetGlassesPageAndCreateStartup();
  }

  if (devicePageLifecycleState === 'active') {
    log('startup lifecycle: active page detected, skipping startup create and using rebuild.');
    return true;
  }

  log('startup lifecycle: creating startup page for first launch.');
  const startupCreateResult = await attemptStartupCreate(
    'first-launch:minimal-single-text',
    buildMinimalStartContainer()
  );

  if (startupCreateResult === 0) {
    writeDevicePageLifecycleState('active');
    return true;
  }

  if (startupCreateResult === 1) {
    log('startup lifecycle: create returned invalid; likely stale active page exists, continuing with rebuild.');
    writeDevicePageLifecycleState('active');
    return true;
  }

  if (startupCreateResult === 2) {
    log('Result 2 = oversize request.');
  } else if (startupCreateResult === 3) {
    log('Result 3 = out of memory.');
  }

  log('startup create failed in first-launch flow');
  return false;
}

async function syncTextToEven(silent = false) {
  if (!bridge || !hasStarted) {
    return;
  }

  try {
    const dialogueUpdate = {
      containerID: GLASSES_CONTAINERS.dialogueText.id,
      containerName: GLASSES_CONTAINERS.dialogueText.name,
      contentOffset: 0,
      contentLength: 1000,
      content: getGlassesDialogueText(),
    };

    const statusUpdate = {
      containerID: GLASSES_CONTAINERS.statusText.id,
      containerName: GLASSES_CONTAINERS.statusText.name,
      contentOffset: 0,
      contentLength: 1000,
      content: getGlassesStatusText(),
    };

    const dialogueOk = await bridge.textContainerUpgrade(dialogueUpdate as any);
    const statusOk = await bridge.textContainerUpgrade(statusUpdate as any);
    const ok = dialogueOk && statusOk;

    if (!silent) {
      log(ok ? 'Text synced to Even.' : 'Text sync failed.');
    }
  } catch (error) {
    log(`Text sync error: ${String(error)}`);
  }
}

function queueGlassesSync() {
  if (!bridge || !hasStarted) {
    return;
  }

  if (glassesSyncTimer !== null) {
    return;
  }

  glassesSyncTimer = window.setTimeout(() => {
    glassesSyncTimer = null;
    void syncTextToEven(true);
  }, 0);
}

function enqueueImageUpdate(update: {
  containerID: number;
  containerName: string;
  imageData: Uint8Array;
}) {
  imageUpdateQueue = imageUpdateQueue
    .then(async () => {
      if (!bridge || !hasStarted) {
        return;
      }

      const result = await bridge.updateImageRawData(update as any);
      if (result !== ImageRawDataUpdateResult.success) {
        log(`Image update failed (${update.containerName}): ${String(result)}`);
      }
    })
    .catch((error) => {
      log(`Image queue error: ${String(error)}`);
    });

  return imageUpdateQueue;
}

async function syncCodecImagesToEven(force = false) {
  if (!bridge || !hasStarted) {
    return;
  }

  const view = glassesCodec.getViewModel();
  const portraitChanged = force || lastRenderedPortraitAsset !== view.portraitAsset;

  if (portraitChanged) {
    const portraitBytes = await getCodecAssetBytes(view.portraitAsset);
    await enqueueImageUpdate({
      containerID: GLASSES_CONTAINERS.portraitImage.id,
      containerName: GLASSES_CONTAINERS.portraitImage.name,
      imageData: portraitBytes,
    });
    lastRenderedPortraitAsset = view.portraitAsset;
  }
}

async function renderCodecGlassesScene(forceImages = false, silentText = true) {
  await syncTextToEven(silentText);
  await syncCodecImagesToEven(forceImages);
}

function stopSpeakingAnimation() {
  if (speakingTimer !== null) {
    window.clearInterval(speakingTimer);
    speakingTimer = null;
  }

  mouthOpen = false;
  barLevel = 0;
}

function startSpeakingAnimation() {
  stopSpeakingAnimation();

  const currentLine = getCurrentLine();

  if (!currentLine) {
    return;
  }

  const levels = [2, 4, 7, 5, 8, 3, 6];

  speakingTimer = window.setInterval(() => {
    mouthOpen = !mouthOpen;
    barLevel = levels[Math.floor(Math.random() * levels.length)];
    renderCodec();
  }, 140);
}

function stopTypewriterEffect() {
  if (typingTimer !== null) {
    window.clearInterval(typingTimer);
    typingTimer = null;
  }

  typingInProgress = false;
}

function startLineEffects() {
  const currentLine = getCurrentLine();

  stopTypewriterEffect();
  stopSpeakingAnimation();

  if (!currentLine) {
    displayedDialogueText = '';
    renderCodec();
    return;
  }

  displayedDialogueText = '';
  typingInProgress = true;
  let letterIndex = 0;
  const fullText = currentLine.text;

  startSpeakingAnimation();
  renderCodec();

  typingTimer = window.setInterval(() => {
    letterIndex += 1;
    displayedDialogueText = fullText.slice(0, letterIndex);
    renderCodec();

    if (letterIndex >= fullText.length) {
      stopTypewriterEffect();
      stopSpeakingAnimation();
      renderCodec();
    }
  }, 26);
}

function renderButtons() {
  prevContactBtn.disabled = !hasStarted || callActive;
  nextContactBtn.disabled = !hasStarted || callActive;
  startCallBtn.disabled = !hasStarted || callActive;
  nextLineBtn.disabled =
    !hasStarted || !callActive || isConversationFinished() || typingInProgress;
  endCallBtn.disabled = !hasStarted || !callActive;
}

function renderCodec() {
  const contact = getCurrentContact();
  const currentLine = getCurrentLine();

  const activeSpeaker = currentLine?.speaker ?? null;
  const leftSpeaking = activeSpeaker === 'left' && mouthOpen;
  const rightSpeaking = activeSpeaker === 'right' && mouthOpen;
  const barsActive = currentLine ? barLevel : 0;

  const barsHtml = Array.from({ length: 10 }, (_, index) => {
    const active = index < barsActive;
    return `<div class="signal-bar ${active ? 'active' : ''}" style="height:${20 + index * 9}px"></div>`;
  }).join('');

  const speakerLabel = currentLine
    ? getSpeakerName(currentLine.speaker)
    : 'Standby';

  const dialogueText = currentLine
    ? displayedDialogueText
    : 'Select a contact and start the call.';
  const typingCursor = currentLine && typingInProgress
    ? '<span class="typing-cursor" aria-hidden="true"></span>'
    : '';
  const latestFeedback = getLatestFeedback();
  const interactionOverlayLabel = getCurrentInteractionLabel();
  const interactionDurationMs = latestFeedback
    ? latestFeedback.expiresAt - latestFeedback.createdAt
    : 0;
  const interactionOverlayHtml = interactionOverlayLabel
    ? `
      <div class="interaction-overlay"
        data-feedback-id="${latestFeedback?.id ?? ''}"
        style="--feedback-duration:${interactionDurationMs}ms">
        ${interactionOverlayLabel}
      </div>
    `
    : '';

  codecMount.innerHTML = `
    <div class="codec-shell">
      <div class="scanlines"></div>
      ${interactionOverlayHtml}

      <div class="codec-top">
        <div class="portrait-frame ${activeSpeaker === 'left' ? 'active' : ''}">
          <div class="portrait-label">${contact.name.toUpperCase()}</div>
          <div class="portrait-face">
            <div class="portrait-silhouette">${contact.portraitTag}</div>
            <div class="mouth-slot ${leftSpeaking ? 'open' : ''}">
              <div class="mouth-core"></div>
            </div>
          </div>
        </div>

        <div class="codec-center">
          <div class="codec-tag top">PTT</div>

          <div class="signal-screen">
            <div class="signal-bars">${barsHtml}</div>
            <div class="frequency">${contact.frequency}</div>
          </div>

          <div class="codec-tag bottom">MEMORY</div>
        </div>

        <div class="portrait-frame ${activeSpeaker === 'right' ? 'active' : ''}">
          <div class="portrait-label">${RIGHT_CHARACTER.name.toUpperCase()}</div>
          <div class="portrait-face">
            <div class="portrait-silhouette">${RIGHT_CHARACTER.portraitTag}</div>
            <div class="mouth-slot ${rightSpeaking ? 'open' : ''}">
              <div class="mouth-core"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="dialogue-box">
        <div class="speaker-name">${speakerLabel}</div>
        <div class="dialogue-text">${dialogueText}${typingCursor}</div>
      </div>
    </div>
  `;

  renderButtons();
}

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function getAllEventBranches(event: EvenHubEvent) {
  const branches: Array<{ source: EventBranchSource; payload: Record<string, unknown> }> = [];

  if (event.listEvent) {
    branches.push({
      source: 'listEvent',
      payload: event.listEvent as unknown as Record<string, unknown>,
    });
  }

  if (event.textEvent) {
    branches.push({
      source: 'textEvent',
      payload: event.textEvent as unknown as Record<string, unknown>,
    });
  }

  if (event.sysEvent) {
    branches.push({
      source: 'sysEvent',
      payload: event.sysEvent as unknown as Record<string, unknown>,
    });
  }

  if (branches.length === 0) {
    branches.push({
      source: 'unknown',
      payload: (event.jsonData ?? {}) as Record<string, unknown>,
    });
  }

  return branches;
}

function formatRawEventType(rawType: unknown) {
  if (typeof rawType === 'number') {
    return OsEventTypeList[rawType] ?? String(rawType);
  }

  if (typeof rawType === 'string') {
    return rawType;
  }

  if (rawType === null || rawType === undefined) {
    return 'UNKNOWN_EVENT';
  }

  return String(rawType);
}

function normalizeTypeToken(rawType: unknown) {
  return formatRawEventType(rawType)
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

function collectEventTypeCandidates(
  payload: Record<string, unknown>,
  event: EvenHubEvent
) {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }

    const token = normalizeTypeToken(value);
    if (!token || candidates.includes(token)) {
      return;
    }

    candidates.push(token);
  };

  pushCandidate(payload.eventType);
  pushCandidate(payload.Event_Type);
  pushCandidate(payload.event_type);
  pushCandidate(payload.type);

  if (event.jsonData) {
    const data = event.jsonData as Record<string, unknown>;
    pushCandidate(data.eventType);
    pushCandidate(data.Event_Type);
    pushCandidate(data.event_type);
    pushCandidate(data.type);
  }

  return candidates;
}

function inspectInputEvent(
  source: EventBranchSource,
  payload: Record<string, unknown>,
  event: EvenHubEvent
): InputInspection {
  const rawEventType = payload.eventType ?? payload.Event_Type ?? payload.event_type ?? null;
  const rawEventTypeName = formatRawEventType(rawEventType);

  const containerID = typeof payload.containerID === 'number'
    ? payload.containerID
    : typeof payload.Container_ID === 'number'
      ? payload.Container_ID
      : null;

  const containerName = typeof payload.containerName === 'string'
    ? payload.containerName
    : typeof payload.Container_Name === 'string'
      ? payload.Container_Name
      : null;

  const currentSelectItemName = typeof payload.currentSelectItemName === 'string'
    ? payload.currentSelectItemName
    : typeof payload.CurrentSelect_ItemName === 'string'
      ? payload.CurrentSelect_ItemName
      : null;

  const currentSelectItemIndex = typeof payload.currentSelectItemIndex === 'number'
    ? payload.currentSelectItemIndex
    : typeof payload.CurrentSelect_ItemIndex === 'number'
      ? payload.CurrentSelect_ItemIndex
      : null;

  const eventTypeCandidates = collectEventTypeCandidates(payload, event);
  const normalizedTypeToken = eventTypeCandidates[0] ?? normalizeTypeToken(rawEventType);

  return {
    source,
    rawEventType,
    rawEventTypeName,
    normalizedTypeToken,
    containerID,
    containerName,
    currentSelectItemName,
    currentSelectItemIndex,
    eventTypeCandidates,
  };
}

function buildListContainerKey(inspection: InputInspection) {
  if (inspection.source !== 'listEvent') {
    return null;
  }

  const idPart = inspection.containerID !== null ? `id:${inspection.containerID}` : 'id:-';
  const namePart = inspection.containerName ?? '-';
  return `${inspection.source}|${idPart}|name:${namePart}`;
}

function getMovementFromListIndex(
  inspection: InputInspection
): NormalizedInput | null {
  if (inspection.source !== 'listEvent' || inspection.currentSelectItemIndex === null) {
    return null;
  }

  const key = buildListContainerKey(inspection);
  if (!key) {
    return null;
  }

  const prev = lastListIndexByContainer.get(key);
  lastListIndexByContainer.set(key, inspection.currentSelectItemIndex);

  if (prev === undefined || prev === inspection.currentSelectItemIndex) {
    return null;
  }

  return inspection.currentSelectItemIndex > prev ? 'DOWN' : 'UP';
}

function normalizeInputFromTypeToken(
  inspection: InputInspection
): NormalizedInput | null {
  const tokens = inspection.eventTypeCandidates.length > 0
    ? inspection.eventTypeCandidates
    : [inspection.normalizedTypeToken];

  for (const token of tokens) {
    if (
      token === 'SCROLL_TOP_EVENT' ||
      token === 'SCROLL_TOP' ||
      token === 'REACHED_TOP_EVENT' ||
      token === 'AT_TOP_EVENT'
    ) {
      return 'AT_TOP';
    }

    if (
      token === 'SCROLL_BOTTOM_EVENT' ||
      token === 'SCROLL_BOTTOM' ||
      token === 'REACHED_BOTTOM_EVENT' ||
      token === 'AT_BOTTOM_EVENT'
    ) {
      return 'AT_BOTTOM';
    }

    if (
      token === 'DOUBLE_CLICK_EVENT' ||
      token === 'DOUBLE_CLICK' ||
      token === 'DOUBLE_TAP_EVENT' ||
      token === 'DOUBLE_TAP' ||
      token === 'DOUBLE_ENTER_EVENT'
    ) {
      return 'DOUBLE_TAP';
    }

    if (
      token === 'SCROLL_UP_EVENT' ||
      token === 'SCROLL_UP' ||
      token === 'MOVE_UP_EVENT' ||
      token === 'MOVE_UP' ||
      token === 'NAV_UP_EVENT' ||
      token === 'UP_EVENT' ||
      token === 'UP'
    ) {
      return 'UP';
    }

    if (
      token === 'SCROLL_DOWN_EVENT' ||
      token === 'SCROLL_DOWN' ||
      token === 'MOVE_DOWN_EVENT' ||
      token === 'MOVE_DOWN' ||
      token === 'NAV_DOWN_EVENT' ||
      token === 'DOWN_EVENT' ||
      token === 'DOWN'
    ) {
      return 'DOWN';
    }

    if (
      token === 'CLICK_EVENT' ||
      token === 'CLICK' ||
      token === 'SINGLE_CLICK_EVENT' ||
      token === 'SINGLE_CLICK' ||
      token === 'ENTER_EVENT' ||
      token === 'ENTER' ||
      token === 'TAP_EVENT' ||
      token === 'TAP' ||
      token === 'SELECT_EVENT' ||
      token === 'SELECT' ||
      token === 'CONFIRM_EVENT' ||
      token === 'CONFIRM' ||
      token === 'OK_EVENT' ||
      token === 'OK'
    ) {
      return 'TAP';
    }
  }

  return null;
}

function normalizeInput(inspection: InputInspection): NormalizedInput | null {
  const movementFromIndex = getMovementFromListIndex(inspection);
  if (movementFromIndex) {
    return movementFromIndex;
  }

  return normalizeInputFromTypeToken(inspection);
}

function normalizedInputToRawInteraction(
  input: NormalizedInput
): RawInteractionType {
  if (input === 'UP') {
    return 'up';
  }

  if (input === 'DOWN') {
    return 'down';
  }

  if (input === 'DOUBLE_TAP') {
    return 'double_click';
  }

  return 'click';
}

function rawInteractionToCodecInput(interaction: RawInteractionType): NormalizedInput {
  if (interaction === 'up') {
    return 'UP';
  }

  if (interaction === 'down') {
    return 'DOWN';
  }

  if (interaction === 'double_click') {
    return 'DOUBLE_TAP';
  }

  return 'TAP';
}

function ensureFeedbackManager() {
  if (feedbackManager) {
    return feedbackManager;
  }

  feedbackManager = new InteractionFeedbackManager({
    onDebugMessage: (message) => {
      debugInteractionLog(message);
    },
    onRawInteraction: (interaction) => {
      debugInteractionLog(`raw detected: ${interaction}`);
    },
    onActionCommitted: (interaction) => {
      debugInteractionLog(`action committed: ${interaction}`);
      const input = rawInteractionToCodecInput(interaction);
      const result = glassesCodec.handleInput(input);

      if (result.changed) {
        log(`Codec input handled: ${input}`);
        void renderCodecGlassesScene(false, true);
      }

      if (result.requestClose) {
        log('Codec close requested.');
        if (bridge && hasStarted) {
          void shutdownGlassesPage('close-request').catch((error) => {
            log(`Close request failed: ${String(error)}`);
          });
        }
      }
    },
    onFeedbackAdded: (item) => {
      activeFeedbackItems.set(item.id, item);
      debugInteractionLog(`feedback created: #${item.id} (${item.interaction})`);
      renderCodec();
      queueGlassesSync();
    },
    onFeedbackRemoved: (item) => {
      activeFeedbackItems.delete(item.id);
      debugInteractionLog(`feedback removed: #${item.id}`);
      renderCodec();
      queueGlassesSync();
    },
  });

  return feedbackManager;
}

function handleEvenHubEvent(event: EvenHubEvent) {
  const branches = getAllEventBranches(event);
  let handledPrimaryAction = false;

  for (const branch of branches) {
    const inspection = inspectInputEvent(branch.source, branch.payload, event);
    const containerKey = buildListContainerKey(inspection);
    const prevIndex = containerKey ? lastListIndexByContainer.get(containerKey) : undefined;

    const logParts = [
      `Input source: ${inspection.source}`,
      `eventType: ${inspection.rawEventTypeName}`,
      `containerID: ${inspection.containerID ?? '-'}`,
      `containerName: ${inspection.containerName ?? '-'}`,
    ];

    if (inspection.currentSelectItemName !== null) {
      logParts.push(`currentSelectItemName: ${inspection.currentSelectItemName}`);
    }

    if (inspection.currentSelectItemIndex !== null) {
      const indexTransition = prevIndex === undefined
        ? `${inspection.currentSelectItemIndex}`
        : `${prevIndex} -> ${inspection.currentSelectItemIndex}`;
      logParts.push(`index: ${indexTransition}`);
    }

    const normalizedInput = normalizeInput(inspection);
    if (!normalizedInput) {
      log(
        `${logParts.join(' | ')} | normalized: NONE (candidates: ${
          inspection.eventTypeCandidates.join(', ') || 'none'
        })`
      );

      if (DEBUG_INTERACTION && !hasLoggedUnknownEventDump) {
        hasLoggedUnknownEventDump = true;
        debugInteractionLog(`Unknown event payload dump: ${safeSerialize(event)}`);
      }

      continue;
    }

    if (normalizedInput === 'AT_TOP' || normalizedInput === 'AT_BOTTOM') {
      log(`Boundary event: ${inspection.rawEventTypeName} | normalized: ${normalizedInput}`);
      continue;
    }

    log(`${logParts.join(' | ')} | normalized: ${normalizedInput}`);
    if (handledPrimaryAction) {
      log(`Action skipped (already handled this event): ${normalizedInput}`);
      continue;
    }

    handledPrimaryAction = true;
    ensureFeedbackManager().handleRawInteraction(normalizedInputToRawInteraction(normalizedInput));
  }
}

function setupEvenHubEventListener() {
  if (!bridge) {
    return;
  }

  if (unsubscribeEvenHubEvents) {
    unsubscribeEvenHubEvents();
    unsubscribeEvenHubEvents = null;
  }

  unsubscribeEvenHubEvents = bridge.onEvenHubEvent((event) => {
    handleEvenHubEvent(event);
  });

  lastListIndexByContainer.clear();
  log('Input listener ready (UP/DOWN/TAP/DOUBLE TAP).');
}

function logEventCaptureSummary() {
  const container = buildStartContainer();
  const textObjects = container.textObject ?? [];
  const imageObjects = container.imageObject ?? [];
  const captureTextContainers = textObjects.filter(
    (item) => item.isEventCapture === 1
  );
  const captureNames = captureTextContainers.map((item) => item.containerName).join(', ');

  log(
    `Event capture summary: total=${container.containerTotalNum ?? '-'}, images=${imageObjects.length}, text=${textObjects.length}, captureCount=${captureTextContainers.length}, capture=${captureNames || 'none'}`
  );
}

async function startOnEven(options?: { forceReset?: boolean }) {
  log('Waiting for Even bridge...');

  try {
    bridge = await waitForEvenAppBridge();
    log('Bridge connected.');
    hasStarted = false;
    const forceReset = Boolean(options?.forceReset && import.meta.env.DEV);
    log(
      `Device page lifecycle state before startup: ${devicePageLifecycleState} (forceReset=${forceReset ? 'yes' : 'no'})`
    );

    const user = await bridge.getUserInfo().catch(() => null);
    const device = await bridge.getDeviceInfo().catch(() => null);

    if (user) {
      log(`User: ${user.name || '(blank name)'}`);
    } else {
      log('User info unavailable.');
    }

    if (device) {
      log(`Device model: ${String(device.model)}`);
      log(`Device SN: ${device.sn}`);
      log(`Connect type: ${device.status?.connectType ?? 'unknown'}`);
    } else {
      log('Device info is null.');
    }

    logEventCaptureSummary();

    const startupReady = await ensureStartupPageLifecycle({ forceReset });
    if (!startupReady) {
      return;
    }

    log('Rebuild step A: compact two-text layout.');
    const twoTextOk = await attemptRebuild('startup:two-text', buildTextOnlyRebuildContainer());
    if (!twoTextOk) {
      log('Startup rebuild failed at two-text stage.');
      return;
    }

    log('Rebuild step B: compact codec layout with portrait + action text.');
    const fullRebuildOk = await attemptRebuild('startup:full-with-portrait', buildRebuildContainer());
    if (!fullRebuildOk) {
      log('Startup rebuild failed at full layout stage.');
      return;
    }

    hasStarted = true;
    setupEvenHubEventListener();
    log('Startup lifecycle complete: rebuild flow ready.');
    renderCodec();
    await renderCodecGlassesScene(true, true);
    return;
  } catch (error) {
    log(`Start error: ${String(error)}`);
  }
}

async function startCall() {
  if (!hasStarted) {
    log('Start on Even first.');
    return;
  }

  callActive = true;
  currentLineIndex = 0;
  log(`Call started with ${getCurrentContact().name}.`);
  startLineEffects();
  await syncTextToEven();
}

async function nextLine() {
  if (!callActive) {
    log('Start a call first.');
    return;
  }

  const contact = getCurrentContact();

  if (currentLineIndex >= contact.dialogue.length - 1) {
    log('No more lines in this conversation.');
    stopTypewriterEffect();
    stopSpeakingAnimation();
    renderCodec();
    return;
  }

  currentLineIndex += 1;
  startLineEffects();
  await syncTextToEven();
}

async function endCall() {
  if (!callActive) {
    log('No active call.');
    return;
  }

  callActive = false;
  currentLineIndex = -1;
  stopTypewriterEffect();
  stopSpeakingAnimation();
  displayedDialogueText = '';
  log('Call ended.');
  renderCodec();
  await syncTextToEven();
}

async function changeContact(direction: -1 | 1) {
  if (callActive) {
    log('End the current call before changing contact.');
    return;
  }

  currentContactIndex =
    (currentContactIndex + direction + contacts.length) % contacts.length;

  displayedDialogueText = '';
  log(`Selected contact: ${getCurrentContact().name}.`);
  renderCodec();
  await syncTextToEven();
}

async function copyLog() {
  const text = logEl.textContent || '';

  try {
    await navigator.clipboard.writeText(text);
    log('Log copied to clipboard.');
  } catch {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      log('Log copied to clipboard.');
    } catch (error) {
      log(`Copy failed: ${String(error)}`);
    }
  }
}

function clearLog() {
  logEl.textContent = '';
  log('Log cleared.');
}

function cleanupInteractionResources() {
  if (unsubscribeEvenHubEvents) {
    unsubscribeEvenHubEvents();
    unsubscribeEvenHubEvents = null;
  }

  if (feedbackManager) {
    feedbackManager.dispose();
    feedbackManager = null;
  }

  activeFeedbackItems.clear();
  lastListIndexByContainer.clear();
  lastRenderedPortraitAsset = null;
  imageUpdateQueue = Promise.resolve();

  if (glassesSyncTimer !== null) {
    window.clearTimeout(glassesSyncTimer);
    glassesSyncTimer = null;
  }
}

startEvenBtn.addEventListener('click', () => {
  void startOnEven();
});

if (resetStartupBtn) {
  resetStartupBtn.addEventListener('click', () => {
    void startOnEven({ forceReset: true });
  });
}

prevContactBtn.addEventListener('click', () => {
  void changeContact(-1);
});

nextContactBtn.addEventListener('click', () => {
  void changeContact(1);
});

startCallBtn.addEventListener('click', () => {
  void startCall();
});

nextLineBtn.addEventListener('click', () => {
  void nextLine();
});

endCallBtn.addEventListener('click', () => {
  void endCall();
});

copyLogBtn.addEventListener('click', () => {
  void copyLog();
});

clearLogBtn.addEventListener('click', () => {
  clearLog();
});

window.addEventListener('beforeunload', () => {
  cleanupInteractionResources();
});

renderCodec();
log('Web UI ready.');

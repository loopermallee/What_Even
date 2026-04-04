import './style.css';
import {
  ImageRawDataUpdateResult,
  OsEventTypeList,
  waitForEvenAppBridge,
  type CreateStartUpPageContainer,
  type EvenHubEvent,
  type ImageContainerProperty,
  type RebuildPageContainer,
  type TextContainerProperty,
  type TextContainerUpgrade,
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

const startEvenBtn = document.querySelector<HTMLButtonElement>('#startEvenBtn');
const prevContactBtn = document.querySelector<HTMLButtonElement>('#prevContactBtn');
const nextContactBtn = document.querySelector<HTMLButtonElement>('#nextContactBtn');
const startCallBtn = document.querySelector<HTMLButtonElement>('#startCallBtn');
const nextLineBtn = document.querySelector<HTMLButtonElement>('#nextLineBtn');
const endCallBtn = document.querySelector<HTMLButtonElement>('#endCallBtn');
const copyLogBtn = document.querySelector<HTMLButtonElement>('#copyLogBtn');
const clearLogBtn = document.querySelector<HTMLButtonElement>('#clearLogBtn');
const codecMount = document.querySelector<HTMLDivElement>('#codecMount');
const logEl = document.querySelector<HTMLPreElement>('#log');

if (
  !startEvenBtn ||
  !prevContactBtn ||
  !nextContactBtn ||
  !startCallBtn ||
  !nextLineBtn ||
  !endCallBtn ||
  !copyLogBtn ||
  !clearLogBtn ||
  !codecMount ||
  !logEl
) {
  throw new Error('Missing required UI elements');
}

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

const GLASSES_ICON_TEXT: Record<RawInteractionType, string> = {
  up: '^',
  down: 'v',
  click: 'o',
  double_click: 'oo',
};

const GLASSES_CONTAINERS = {
  frameImage: { id: 101, name: 'codec-frame' },
  portraitImage: { id: 102, name: 'codec-face' },
  dialogueText: { id: 103, name: 'codec-dialog' },
  statusText: { id: 104, name: 'codec-status' },
} as const;

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

const STARTUP_CONTAINER_READY_KEY = 'what-even:startup-container-ready';
let hasLoggedUnknownEventDump = false;
const lastListIndexByContainer = new Map<string, number>();
const glassesCodec = new CodecGlassesController();
let lastRenderedFrameAsset: CodecAssetKey | null = null;
let lastRenderedPortraitAsset: CodecAssetKey | null = null;
let imageUpdateQueue = Promise.resolve();

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

function readStartupContainerReadyFlag() {
  try {
    return localStorage.getItem(STARTUP_CONTAINER_READY_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStartupContainerReadyFlag(value: boolean) {
  try {
    localStorage.setItem(STARTUP_CONTAINER_READY_KEY, value ? '1' : '0');
  } catch {
    // no-op: storage may be unavailable in some webview environments
  }
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

function getCurrentGlassesIndicator() {
  const latest = getLatestFeedback();
  if (!latest) {
    return '--';
  }

  return GLASSES_ICON_TEXT[latest.interaction];
}

function isConversationFinished() {
  const contact = getCurrentContact();
  return callActive && currentLineIndex >= contact.dialogue.length - 1;
}

function getSpeakerName(side: SpeakerSide) {
  return side === 'left' ? getCurrentContact().name : RIGHT_CHARACTER.name;
}

function getGlassesDialogueText() {
  return glassesCodec.getViewModel().dialogue;
}

function getGlassesStatusText() {
  const view = glassesCodec.getViewModel();
  const interactionHint = `IN ${getCurrentGlassesIndicator()}`;
  return [view.status, interactionHint].join('\n');
}

function buildDialogueContainer(content: string): TextContainerProperty {
  return {
    xPosition: 132,
    yPosition: 18,
    width: 430,
    height: 112,
    containerID: GLASSES_CONTAINERS.dialogueText.id,
    containerName: GLASSES_CONTAINERS.dialogueText.name,
    content,
    isEventCapture: 0,
  };
}

function buildStatusContainer(content: string): TextContainerProperty {
  return {
    xPosition: 16,
    yPosition: 136,
    width: 544,
    height: 116,
    containerID: GLASSES_CONTAINERS.statusText.id,
    containerName: GLASSES_CONTAINERS.statusText.name,
    content,
    isEventCapture: 1,
  };
}

function buildFrameImageContainer(): ImageContainerProperty {
  return {
    xPosition: 176,
    yPosition: 20,
    width: 200,
    height: 100,
    containerID: GLASSES_CONTAINERS.frameImage.id,
    containerName: GLASSES_CONTAINERS.frameImage.name,
  };
}

function buildPortraitImageContainer(): ImageContainerProperty {
  return {
    xPosition: 24,
    yPosition: 22,
    width: 96,
    height: 96,
    containerID: GLASSES_CONTAINERS.portraitImage.id,
    containerName: GLASSES_CONTAINERS.portraitImage.name,
  };
}

function buildStartContainer(): CreateStartUpPageContainer {
  return {
    containerTotalNum: 4,
    imageObject: [buildFrameImageContainer(), buildPortraitImageContainer()],
    textObject: [
      buildDialogueContainer(getGlassesDialogueText()),
      buildStatusContainer(getGlassesStatusText()),
    ],
  };
}

function buildRebuildContainer(): RebuildPageContainer {
  return {
    containerTotalNum: 4,
    imageObject: [buildFrameImageContainer(), buildPortraitImageContainer()],
    textObject: [
      buildDialogueContainer(getGlassesDialogueText()),
      buildStatusContainer(getGlassesStatusText()),
    ],
  };
}

function buildRebuildContainerVariant(options: {
  includeFrameImage: boolean;
  includePortraitImage: boolean;
}): RebuildPageContainer {
  const imageObject: ImageContainerProperty[] = [];

  if (options.includeFrameImage) {
    imageObject.push(buildFrameImageContainer());
  }

  if (options.includePortraitImage) {
    imageObject.push(buildPortraitImageContainer());
  }

  return {
    containerTotalNum: 2 + imageObject.length,
    imageObject,
    textObject: [
      buildDialogueContainer(getGlassesDialogueText()),
      buildStatusContainer(getGlassesStatusText()),
    ],
  };
}

function describeRebuildPayload(payload: RebuildPageContainer) {
  const textObject = (payload.textObject ?? []).map((item) => ({
    containerID: item.containerID,
    containerName: item.containerName,
    xPosition: item.xPosition,
    yPosition: item.yPosition,
    width: item.width,
    height: item.height,
    isEventCapture: item.isEventCapture ?? 0,
  }));

  const imageObject = (payload.imageObject ?? []).map((item) => ({
    containerID: item.containerID,
    containerName: item.containerName,
    xPosition: item.xPosition,
    yPosition: item.yPosition,
    width: item.width,
    height: item.height,
  }));

  const captureContainer = textObject.find((item) => item.isEventCapture === 1)?.containerName ?? 'none';

  return {
    containerTotalNum: payload.containerTotalNum ?? null,
    textObject,
    imageObject,
    captureContainer,
  };
}

function validateRebuildPayload(payload: RebuildPageContainer) {
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
  payload: RebuildPageContainer
) {
  if (!bridge) {
    return false;
  }

  const payloadView = describeRebuildPayload(payload);
  log(`Rebuild attempt (${label}) payload: ${safeSerialize(payloadView)}`);
  const validation = validateRebuildPayload(payload);

  if (!validation.valid) {
    log(`Rebuild skipped due to invalid payload (${label}).`);
    for (const error of validation.errors) {
      log(`Validation error: ${error}`);
    }
    return false;
  }

  const rebuilt = await bridge.rebuildPageContainer(payload as any);
  if (rebuilt) {
    log(`rebuildPageContainer result (${label}): true`);
    return true;
  }

  log(`Rebuild failed after local validation passed (${label}).`);
  log(`Attempted payload (${label}): ${safeSerialize(payloadView)}`);
  return false;
}

async function syncTextToEven(silent = false) {
  if (!bridge || !hasStarted) {
    return;
  }

  try {
    const dialogueUpdate: TextContainerUpgrade = {
      containerID: GLASSES_CONTAINERS.dialogueText.id,
      containerName: GLASSES_CONTAINERS.dialogueText.name,
      contentOffset: 0,
      contentLength: 1000,
      content: getGlassesDialogueText(),
    };

    const statusUpdate: TextContainerUpgrade = {
      containerID: GLASSES_CONTAINERS.statusText.id,
      containerName: GLASSES_CONTAINERS.statusText.name,
      contentOffset: 0,
      contentLength: 1000,
      content: getGlassesStatusText(),
    };

    const dialogueOk = await bridge.textContainerUpgrade(dialogueUpdate);
    const statusOk = await bridge.textContainerUpgrade(statusUpdate);
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
  const frameChanged = force || lastRenderedFrameAsset !== view.frameAsset;
  const portraitChanged = force || lastRenderedPortraitAsset !== view.portraitAsset;

  if (frameChanged) {
    const frameBytes = await getCodecAssetBytes(view.frameAsset);
    await enqueueImageUpdate({
      containerID: GLASSES_CONTAINERS.frameImage.id,
      containerName: GLASSES_CONTAINERS.frameImage.name,
      imageData: frameBytes,
    });
    lastRenderedFrameAsset = view.frameAsset;
  }

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
          void bridge.shutDownPageContainer(0).catch((error) => {
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

async function rebuildPageWithCurrentText() {
  if (!bridge) {
    return false;
  }

  const fullPayload = buildRebuildContainer();
  let rebuilt = await attemptRebuild('full', fullPayload);

  if (!rebuilt) {
    log('Starting rebuild isolation mode: Step A text-only, Step B text+frame, Step C full.');

    const textOnlyPayload = buildRebuildContainerVariant({
      includeFrameImage: false,
      includePortraitImage: false,
    });
    const textOnlyOk = await attemptRebuild('isolation:text-only', textOnlyPayload);

    let textFrameOk = false;
    if (textOnlyOk) {
      const textFramePayload = buildRebuildContainerVariant({
        includeFrameImage: true,
        includePortraitImage: false,
      });
      textFrameOk = await attemptRebuild('isolation:text+frame', textFramePayload);
    } else {
      log('Isolation result: text-only failed. Problem is in text/capture/count/layout payload.');
    }

    let fullIsolationOk = false;
    if (textFrameOk) {
      const fullIsolationPayload = buildRebuildContainerVariant({
        includeFrameImage: true,
        includePortraitImage: true,
      });
      fullIsolationOk = await attemptRebuild(
        'isolation:text+frame+portrait',
        fullIsolationPayload
      );
    } else if (textOnlyOk) {
      log('Isolation result: text+frame failed. Frame image container likely invalid.');
    }

    if (textFrameOk && !fullIsolationOk) {
      log('Isolation result: portrait image container likely invalid.');
    }

    rebuilt = fullIsolationOk;
  }

  if (rebuilt) {
    hasStarted = true;
    writeStartupContainerReadyFlag(true);
    setupEvenHubEventListener();
    log('Page rebuilt successfully.');
    renderCodec();
    await renderCodecGlassesScene(true, true);
    return true;
  }

  log('Rebuild failed.');
  return false;
}

async function startOnEven() {
  log('Waiting for Even bridge...');

  try {
    bridge = await waitForEvenAppBridge();
    log('Bridge connected.');

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

    if (hasStarted) {
      log('Bridge already started in this session. Using rebuildPageContainer for refresh.');
      await rebuildPageWithCurrentText();
      return;
    }

    if (readStartupContainerReadyFlag()) {
      log('Startup container already initialized in this app context; using rebuildPageContainer directly.');
      await rebuildPageWithCurrentText();
      return;
    }

    const startupContainer = buildStartContainer();
    const startupResult = await bridge.createStartUpPageContainer(startupContainer);
    log(`createStartUpPageContainer result: ${startupResult}`);

    if (startupResult === 0) {
      hasStarted = true;
      writeStartupContainerReadyFlag(true);
      setupEvenHubEventListener();
      log('Startup page created successfully.');
      renderCodec();
      await renderCodecGlassesScene(true, true);
      return;
    }

    if (startupResult === 1) {
      log('Result 1 = invalid request.');
      log('Likely page already exists for this app context. Falling back to rebuildPageContainer.');
      writeStartupContainerReadyFlag(true);
      await rebuildPageWithCurrentText();
      return;
    }

    if (startupResult === 2) {
      log('Result 2 = oversize request.');
    } else if (startupResult === 3) {
      log('Result 3 = out of memory.');
    }
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
  lastRenderedFrameAsset = null;
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

import './style.css';
import {
  waitForEvenAppBridge,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type TextContainerProperty,
  type TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root element');
}

app.innerHTML = `
  <div class="wrap">
    <h1>What Even</h1>
    <p class="subtitle">Minimal Even test</p>

    <div class="card">
      <div class="row">
        <button id="startBtn">Start on Even</button>
        <button id="updateBtn" disabled>Update Text</button>
        <button id="closeBtn" disabled>Close Page</button>
        <button id="copyBtn">Copy Log</button>
      </div>

      <p class="hint">
        Start once, then test update and close.
      </p>

      <pre id="log" class="log"></pre>
    </div>
  </div>
`;

const startBtn = document.querySelector<HTMLButtonElement>('#startBtn');
const updateBtn = document.querySelector<HTMLButtonElement>('#updateBtn');
const closeBtn = document.querySelector<HTMLButtonElement>('#closeBtn');
const copyBtn = document.querySelector<HTMLButtonElement>('#copyBtn');
const logEl = document.querySelector<HTMLPreElement>('#log');

if (!startBtn || !updateBtn || !closeBtn || !copyBtn || !logEl) {
  throw new Error('Missing required UI elements');
}

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null;
let hasStarted = false;
let updateCount = 0;

function log(message: string) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function getStatusText() {
  if (updateCount === 0) {
    return 'What Even\nReady';
  }

  return `What Even\nUpdated ${updateCount}`;
}

function setControlsEnabled(enabled: boolean) {
  updateBtn.disabled = !enabled;
  closeBtn.disabled = !enabled;
}

function buildTextContainer(): TextContainerProperty {
  return {
    xPosition: 100,
    yPosition: 100,
    width: 200,
    height: 50,
    containerID: 1,
    containerName: 'text-1',
    content: getStatusText(),
    isEventCapture: 1,
  };
}

function buildContainer(): CreateStartUpPageContainer {
  return {
    containerTotalNum: 1,
    textObject: [buildTextContainer()],
  };
}

async function startPlugin() {
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

    const startupContainer = buildContainer();
    const startupResult = await bridge.createStartUpPageContainer(startupContainer);
    log(`createStartUpPageContainer result: ${startupResult}`);

    if (startupResult === 0) {
      hasStarted = true;
      setControlsEnabled(true);
      log('Startup page created successfully.');
      return;
    }

    if (startupResult === 1) {
      log('Result 1 = invalid request.');
      log('Trying rebuildPageContainer as fallback...');

      const rebuildContainer: RebuildPageContainer = buildContainer();
      const rebuilt = await bridge.rebuildPageContainer(rebuildContainer);
      log(`rebuildPageContainer result: ${rebuilt}`);

      if (rebuilt) {
        hasStarted = true;
        setControlsEnabled(true);
        log('Page rebuilt successfully.');
      } else {
        log('Rebuild failed.');
      }

      return;
    }

    if (startupResult === 2) {
      log('Result 2 = oversize request.');
    } else if (startupResult === 3) {
      log('Result 3 = out of memory.');
    }
  } catch (error) {
    log(`Error: ${String(error)}`);
  }
}

async function updateText() {
  if (!bridge || !hasStarted) {
    log('Start on Even first.');
    return;
  }

  updateCount += 1;

  try {
    const update: TextContainerUpgrade = {
      containerID: 1,
      containerName: 'text-1',
      contentOffset: 0,
      contentLength: 1000,
      content: getStatusText(),
    };

    const ok = await bridge.textContainerUpgrade(update);
    log(ok ? 'Text updated successfully.' : 'Text update failed.');
  } catch (error) {
    log(`Update error: ${String(error)}`);
  }
}

async function closePage() {
  if (!bridge || !hasStarted) {
    log('Nothing to close.');
    return;
  }

  try {
    const ok = await bridge.shutDownPageContainer(0);
    log(ok ? 'Page closed.' : 'Close request failed.');
    hasStarted = false;
    updateCount = 0;
    setControlsEnabled(false);
  } catch (error) {
    log(`Close error: ${String(error)}`);
  }
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

startBtn.addEventListener('click', () => {
  void startPlugin();
});

updateBtn.addEventListener('click', () => {
  void updateText();
});

closeBtn.addEventListener('click', () => {
  void closePage();
});

copyBtn.addEventListener('click', () => {
  void copyLog();
});

log('Web UI ready.');
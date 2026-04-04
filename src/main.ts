import './style.css';
import {
  waitForEvenAppBridge,
  type TextContainerProperty,
} from '@evenrealities/even_hub_sdk';

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null;
let started = false;
let updateCount = 0;
let unsubscribeEvent: (() => void) | null = null;

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root element');
}

app.innerHTML = `
  <div class="wrap">
    <h1>What Even</h1>
    <p class="subtitle">My first Even G2 plugin.</p>

    <div class="card">
      <div class="row">
        <button id="startBtn">Start on Even</button>
        <button id="updateBtn">Update Status</button>
        <button id="closeBtn">Close Page</button>
      </div>

      <p class="hint">
        Use this inside the Even beta app or simulator. A normal browser page alone will not give you the Even bridge.
      </p>

      <pre id="log" class="log"></pre>
    </div>
  </div>
`;

const startBtn = document.querySelector<HTMLButtonElement>('#startBtn');
const updateBtn = document.querySelector<HTMLButtonElement>('#updateBtn');
const closeBtn = document.querySelector<HTMLButtonElement>('#closeBtn');
const logEl = document.querySelector<HTMLPreElement>('#log');

if (!startBtn || !updateBtn || !closeBtn || !logEl) {
  throw new Error('Missing required UI elements');
}

function log(message: string) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function getStatusText() {
  return `What Even\nStarted\nUpdates: ${updateCount}`;
}

async function startPlugin() {
  if (started) {
    log('Startup page already created.');
    return;
  }

  log('Waiting for Even bridge...');

  try {
    bridge = await waitForEvenAppBridge();
    log('Bridge connected.');

    const textContainer: TextContainerProperty = {
      xPosition: 24,
      yPosition: 24,
      width: 528,
      height: 96,
      borderWidth: 1,
      borderColor: 5,
      borderRdaius: 6,
      paddingLength: 8,
      containerID: 1,
      containerName: 'statusbox',
      content: getStatusText(),
      isEventCapture: 1,
    };

    const result = await bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [textContainer],
    });

    if (result === 0) {
      started = true;
      log('Startup page created successfully.');

      unsubscribeEvent = bridge.onEvenHubEvent((event) => {
        if (event.listEvent) {
          log(`List event: ${JSON.stringify(event.listEvent)}`);
        } else if (event.textEvent) {
          log(`Text event: ${JSON.stringify(event.textEvent)}`);
        } else if (event.sysEvent) {
          log(`System event: ${JSON.stringify(event.sysEvent)}`);
        } else if (event.audioEvent) {
          log(`Audio event received: ${event.audioEvent.audioPcm.length} bytes`);
        } else {
          log(`Unknown event: ${JSON.stringify(event.jsonData ?? event)}`);
        }
      });
    } else {
      log(`Startup page failed with result code: ${result}`);
    }
  } catch (error) {
    log(`Bridge/start error: ${String(error)}`);
    log('Open this through the Even beta app or simulator, not a normal browser tab alone.');
  }
}

async function updateStatus() {
  if (!bridge || !started) {
    log('Start the plugin first.');
    return;
  }

  updateCount += 1;

  try {
    const ok = await bridge.textContainerUpgrade({
      containerID: 1,
      containerName: 'statusbox',
      contentOffset: 0,
      contentLength: 100,
      content: getStatusText(),
    });

    log(ok ? 'Status updated.' : 'Status update failed.');
  } catch (error) {
    log(`Update error: ${String(error)}`);
  }
}

async function closePlugin() {
  if (!bridge || !started) {
    log('Nothing to close yet.');
    return;
  }

  try {
    const ok = await bridge.shutDownPageContainer(0);
    log(ok ? 'Page closed.' : 'Close request failed.');
    started = false;
    updateCount = 0;

    if (unsubscribeEvent) {
      unsubscribeEvent();
      unsubscribeEvent = null;
    }
  } catch (error) {
    log(`Close error: ${String(error)}`);
  }
}

startBtn.addEventListener('click', startPlugin);
updateBtn.addEventListener('click', updateStatus);
closeBtn.addEventListener('click', closePlugin);

log('Web UI ready.');
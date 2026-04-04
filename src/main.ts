import './style.css';
import {
  waitForEvenAppBridge,
  type CreateStartUpPageContainer,
  type TextContainerProperty,
} from '@evenrealities/even_hub_sdk';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app root element');
}

app.innerHTML = `
  <div class="wrap">
    <h1>What Even</h1>
    <p class="subtitle">Fresh-start Even G2 test</p>

    <div class="card">
      <div class="row">
        <button id="startBtn">Start on Even</button>
      </div>

      <p class="hint">
        This is the smallest startup test based on the Even SDK docs.
      </p>

      <pre id="log" class="log"></pre>
    </div>
  </div>
`;

const startBtn = document.querySelector<HTMLButtonElement>('#startBtn');
const logEl = document.querySelector<HTMLPreElement>('#log');

if (!startBtn || !logEl) {
  throw new Error('Missing required UI elements');
}

let hasStarted = false;

function log(message: string) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function startPlugin() {
  if (hasStarted) {
    log('Startup page was already requested once.');
    return;
  }

  log('Waiting for Even bridge...');

  try {
    const bridge = await waitForEvenAppBridge();
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

    const textContainer: TextContainerProperty = {
      xPosition: 100,
      yPosition: 100,
      width: 200,
      height: 50,
      containerID: 1,
      containerName: 'text-1',
      content: 'Hello World',
      isEventCapture: 1,
    };

    const container: CreateStartUpPageContainer = {
      containerTotalNum: 1,
      textObject: [textContainer],
    };

    const result = await bridge.createStartUpPageContainer(container);
    log(`createStartUpPageContainer result: ${result}`);

    if (result === 0) {
      hasStarted = true;
      log('Startup page created successfully.');
    } else if (result === 1) {
      log('Result 1 = invalid request.');
    } else if (result === 2) {
      log('Result 2 = oversize request.');
    } else if (result === 3) {
      log('Result 3 = out of memory.');
    }
  } catch (error) {
    log(`Error: ${String(error)}`);
  }
}

startBtn.addEventListener('click', () => {
  void startPlugin();
});

log('Web UI ready.');
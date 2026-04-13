import { waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { AppStore } from '../app/state';
import { GLASSES_CONTAINERS } from '../glass/shared';
import { getCodecAssetBytes } from '../codecGlassesAssets';
import { InteractionFeedbackManager, type RawInteractionType } from '../interaction-feedback';
import { AppGlasses } from '../glass/AppGlasses';
import { EvenInputNormalizer } from './eventNormalizer';
import { SerializedImageQueue } from './imageQueue';
import { StartupLifecycleManager } from './startupLifecycle';

function normalizedInputToRawInteraction(input: 'UP' | 'DOWN' | 'TAP' | 'DOUBLE_TAP') {
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

function rawInteractionToNormalized(interaction: RawInteractionType): 'UP' | 'DOWN' | 'TAP' | 'DOUBLE_TAP' {
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

export class EvenBridgeApp {
  private readonly store: AppStore;
  private readonly glasses: AppGlasses;
  private bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null;
  private unsubscribeEvenHubEvents: (() => void) | null = null;
  private feedbackManager: InteractionFeedbackManager | null = null;
  private normalizer = new EvenInputNormalizer();
  private imageQueue: SerializedImageQueue | null = null;
  private startupLifecycle: StartupLifecycleManager | null = null;
  private glassesSyncTimer: number | null = null;
  private lastRenderedPortraitAsset: string | null = null;
  private lastSyncSignature = '';

  constructor(store: AppStore, glasses: AppGlasses) {
    this.store = store;
    this.glasses = glasses;
  }

  async startOnEven(options?: { forceReset?: boolean }) {
    this.store.log('Waiting for Even bridge...');

    try {
      this.bridge = await waitForEvenAppBridge();
      this.store.log('Bridge connected.');
      this.store.setStarted(false);

      const forceReset = Boolean(options?.forceReset && import.meta.env.DEV);
      this.store.log(
        `Device page lifecycle state before startup: ${this.store.getState().deviceLifecycleState} (forceReset=${forceReset ? 'yes' : 'no'})`
      );

      this.startupLifecycle = new StartupLifecycleManager({
        bridge: this.bridge,
        log: (message) => this.store.log(message),
        getLifecycleState: () => this.store.getState().deviceLifecycleState,
        setLifecycleState: (value) => this.store.setDeviceLifecycleState(value),
      });

      this.imageQueue = new SerializedImageQueue({
        updateImage: async (request) => {
          if (!this.bridge) {
            return -1;
          }

          return this.bridge.updateImageRawData(request as any);
        },
        log: (message) => this.store.log(message),
      });

      const user = await this.bridge.getUserInfo().catch(() => null);
      const device = await this.bridge.getDeviceInfo().catch(() => null);

      if (user) {
        this.store.log(`User: ${user.name || '(blank name)'}`);
      } else {
        this.store.log('User info unavailable.');
      }

      if (device) {
        this.store.log(`Device model: ${String(device.model)}`);
        this.store.log(`Device SN: ${device.sn}`);
        this.store.log(`Connect type: ${device.status?.connectType ?? 'unknown'}`);
      } else {
        this.store.log('Device info is null.');
      }

      const startupReady = await this.startupLifecycle.ensureStartupPageLifecycle({
        forceReset,
        minimalStartPayload: this.glasses.buildMinimalStartContainer(),
      });

      if (!startupReady) {
        return;
      }

      this.store.log('Rebuild step A: compact two-text layout.');
      const twoTextOk = await this.startupLifecycle.attemptRebuild('startup:two-text', this.glasses.buildTextOnlyRebuildContainer());
      if (!twoTextOk) {
        this.store.log('Startup rebuild failed at two-text stage.');
        return;
      }

      this.store.log('Rebuild step B: compact codec layout with portrait + action text.');
      const fullRebuildOk = await this.startupLifecycle.attemptRebuild('startup:full-with-portrait', this.glasses.buildRebuildContainer());
      if (!fullRebuildOk) {
        this.store.log('Startup rebuild failed at full layout stage.');
        return;
      }

      this.store.setStarted(true);
      this.setupEvenHubEventListener();
      this.store.log('Startup lifecycle complete: rebuild flow ready.');
      await this.syncNow(true);
    } catch (error) {
      this.store.log(`Start error: ${String(error)}`);
    }
  }

  queueSyncFromState() {
    if (!this.bridge || !this.store.getState().started) {
      return;
    }

    const signature = this.getSyncSignature();
    if (signature === this.lastSyncSignature) {
      return;
    }

    this.lastSyncSignature = signature;

    if (this.glassesSyncTimer !== null) {
      return;
    }

    this.glassesSyncTimer = window.setTimeout(() => {
      this.glassesSyncTimer = null;
      void this.syncNow(false);
    }, 0);
  }

  cleanup() {
    if (this.unsubscribeEvenHubEvents) {
      this.unsubscribeEvenHubEvents();
      this.unsubscribeEvenHubEvents = null;
    }

    if (this.feedbackManager) {
      this.feedbackManager.dispose();
      this.feedbackManager = null;
    }

    if (this.glassesSyncTimer !== null) {
      window.clearTimeout(this.glassesSyncTimer);
      this.glassesSyncTimer = null;
    }

    this.normalizer.clear();
    this.imageQueue?.reset();
    this.lastRenderedPortraitAsset = null;
    this.lastSyncSignature = '';
  }

  private setupEvenHubEventListener() {
    if (!this.bridge) {
      return;
    }

    if (this.unsubscribeEvenHubEvents) {
      this.unsubscribeEvenHubEvents();
      this.unsubscribeEvenHubEvents = null;
    }

    this.normalizer.clear();
    this.normalizer.seedListIndex(
      GLASSES_CONTAINERS.statusList.id,
      GLASSES_CONTAINERS.statusList.name,
      this.glasses.getActionSeedIndex()
    );

    this.feedbackManager = new InteractionFeedbackManager({
      onActionCommitted: (interaction) => {
        const input = rawInteractionToNormalized(interaction);
        const inspection = this.store.getState().lastRawEvent;
        if (!inspection) {
          return;
        }

        const result = this.glasses.handleNormalizedInput(input, inspection);
        if (result.changed) {
          this.store.log(`Codec input handled: ${input}`);
          this.queueSyncFromState();
        }

        if (result.requestClose) {
          this.store.log('Codec close requested.');
          void this.requestClose();
        }
      },
    });

    this.unsubscribeEvenHubEvents = this.bridge.onEvenHubEvent((event) => {
      this.handleEvenHubEvent(event);
    });

    this.store.log('Input listener ready (UP/DOWN/TAP/DOUBLE TAP).');
  }

  private async requestClose() {
    if (!this.startupLifecycle) {
      return;
    }

    await this.startupLifecycle.shutdown('close-request').catch((error) => {
      this.store.log(`Close request failed: ${String(error)}`);
    });
    this.store.setStarted(false);
  }

  private handleEvenHubEvent(event: EvenHubEvent) {
    if (!this.feedbackManager) {
      return;
    }

    const normalized = this.normalizer.normalize(event);
    let handledPrimaryAction = false;

    for (const item of normalized) {
      this.store.log(item.logLine);

      if (!item.input) {
        continue;
      }

      this.store.setLastInput(item.input, item.inspection);

      if (item.input === 'AT_TOP' || item.input === 'AT_BOTTOM') {
        continue;
      }

      if (handledPrimaryAction) {
        this.store.log(`Action skipped (already handled this event): ${item.input}`);
        continue;
      }

      handledPrimaryAction = true;
      this.feedbackManager.handleRawInteraction(normalizedInputToRawInteraction(item.input));
    }
  }

  private async syncNow(forceImages: boolean) {
    if (!this.bridge || !this.startupLifecycle || !this.store.getState().started) {
      return;
    }

    await this.startupLifecycle.attemptRebuild('state-sync', this.glasses.buildRebuildContainer());

    await this.syncText();
    await this.syncImages(forceImages);

    this.normalizer.seedListIndex(
      GLASSES_CONTAINERS.statusList.id,
      GLASSES_CONTAINERS.statusList.name,
      this.glasses.getActionSeedIndex()
    );
  }

  private async syncText() {
    if (!this.bridge || !this.store.getState().started) {
      return;
    }

    try {
      const dialogueUpdate = {
        containerID: GLASSES_CONTAINERS.dialogueText.id,
        containerName: GLASSES_CONTAINERS.dialogueText.name,
        contentOffset: 0,
        contentLength: 1000,
        content: this.glasses.getDialogueText(),
      };

      const ok = await this.bridge.textContainerUpgrade(dialogueUpdate as any);
      this.store.log(ok ? 'Text synced to Even.' : 'Text sync failed.');
    } catch (error) {
      this.store.log(`Text sync error: ${String(error)}`);
    }
  }

  private async syncImages(force = false) {
    if (!this.imageQueue || !this.store.getState().started) {
      return;
    }

    const portraitAsset = this.glasses.getPortraitAssetKey();
    const changed = force || this.lastRenderedPortraitAsset !== portraitAsset;
    if (!changed) {
      return;
    }

    try {
      const portraitBytes = await getCodecAssetBytes(portraitAsset);
      await this.imageQueue.enqueue({
        containerID: GLASSES_CONTAINERS.portraitImage.id,
        containerName: GLASSES_CONTAINERS.portraitImage.name,
        imageData: portraitBytes,
      });

      this.lastRenderedPortraitAsset = portraitAsset;
      this.store.setImageSyncDebug({
        lastPortraitAsset: portraitAsset,
        lastResult: 'success',
        lastAt: Date.now(),
      });
    } catch {
      this.store.setImageSyncDebug({
        lastPortraitAsset: portraitAsset,
        lastResult: 'failed',
        lastAt: Date.now(),
      });
    }
  }

  private getSyncSignature() {
    const state = this.store.getState();
    return JSON.stringify({
      screen: state.screen,
      screenBeforeDebug: state.screenBeforeDebug,
      selectedContactIndex: state.selectedContactIndex,
      incomingActionIndex: state.incomingActionIndex,
      activeActionIndex: state.activeActionIndex,
      endedActionIndex: state.endedActionIndex,
      dialogueIndex: state.dialogueIndex,
      lastNormalizedInput: state.lastNormalizedInput,
      lastRawEventType: state.lastRawEvent?.rawEventTypeName ?? null,
    });
  }
}

import { waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { CONTACTS } from '../app/contacts';
import { AppStore } from '../app/state';
import { GLASSES_CONTAINERS } from '../glass/shared';
import { getCodecAssetBytes } from '../codecGlassesAssets';
import { InteractionFeedbackManager, type RawInteractionType } from '../interaction-feedback';
import { AppGlasses } from '../glass/AppGlasses';
import { EvenInputNormalizer } from './eventNormalizer';
import { SerializedImageQueue } from './imageQueue';
import { StartupLifecycleManager } from './startupLifecycle';
import { AudioCaptureController } from './audio';
import { DeepgramStreamingSttSession, type StreamingSttSession } from './stt';
import { createAppError, isAppError, redactSensitiveText, toErrorMessage, type AppError } from '../app/errors';
import type { ErrorCategory, EvenStartupBlockedCode } from '../app/types';
import { requestSttBrokerAuth } from './sttAuth';

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

type CleanupReason =
  | 'continue'
  | 'end'
  | 'ignore'
  | 'back'
  | 'contact_change'
  | 'shutdown'
  | 'close-request'
  | 'cleanup'
  | 'state-sync'
  | 'stt-retry'
  | 'stale-session'
  | 'session-rollover'
  | 'post-open-reconcile'
  | 'post-start-reconcile';

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
  private syncInFlight = false;
  private syncQueuedWhileInFlight = false;
  private syncNeedsForcedImages = false;
  private lastRenderedPortraitAsset: string | null = null;
  private lastSyncedTextContent = '';
  private lastSyncSignature = '';
  private unsubscribeStore: (() => void) | null = null;
  private previousObservedState: { screen: string; selectedContactIndex: number; started: boolean } | null = null;
  private pendingCleanupReason: CleanupReason | null = null;
  private readonly audioCapture = new AudioCaptureController({ maxBufferDurationMs: 10_000 });
  private sttSession: StreamingSttSession | null = null;
  private activeSttListeningSessionId: number | null = null;
  private activeSttSessionToken: number | null = null;
  private nextSttSessionToken = 1;
  private sttReconnectAttemptedSessionId: number | null = null;
  private sttRetryTimer: number | null = null;
  private lastCommittedFinal: { sessionToken: number; text: string; at: number } | null = null;
  private pendingPartialFlushTimer: number | null = null;
  private pendingPartialText: string | null = null;
  private pendingPartialSessionToken: number | null = null;
  private pendingPartialListeningSessionId: number | null = null;
  private pendingPartialSessionRef: StreamingSttSession | null = null;
  private lastAudioMetricPushAt = 0;
  private lastAudioDropLogAt = 0;
  private lastStaleNote: { key: string; at: number } | null = null;
  private readonly sttRetryDelayMs = 350;
  private readonly sttAdjacentFinalDedupeWindowMs = 1200;
  private readonly syncDebounceMs = 70;
  private readonly audioMetricThrottleMs = 90;
  private readonly audioDropLogThrottleMs = 1500;
  private readonly sttPartialFlushMs = 70;
  private readonly staleLogCooldownMs = 800;

  constructor(store: AppStore, glasses: AppGlasses) {
    this.store = store;
    this.glasses = glasses;
  }

  async startOnEven(options?: { forceReset?: boolean }) {
    this.store.log('Waiting for Even bridge...');
    this.store.setEvenStartupStarting();
    this.store.setStarted(false);

    try {
      this.bridge = await waitForEvenAppBridge();
      this.store.log('Bridge connected.');

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

      if (!startupReady.ok) {
        this.markStartupBlocked(
          'startup_lifecycle_failed',
          'Startup lifecycle create/reset failed before rebuild.'
        );
        return;
      }

      let rebuildReady = await this.runStartupRebuildFlow('startup');
      if (!rebuildReady.ok && startupReady.activeStateWasHint) {
        this.store.log('Startup rebuild failed after active-state hint. Running one stale-active recovery attempt.');
        rebuildReady = await this.recoverFromStaleActiveAndRetryOnce();
        if (!rebuildReady.ok) {
          this.markStartupBlocked(
            'stale_recovery_failed',
            `Stale-active recovery failed at ${rebuildReady.failedStage}.`
          );
          return;
        }
      } else if (!rebuildReady.ok) {
        this.markStartupBlocked(
          'rebuild_failed_initial',
          `Startup rebuild failed at ${rebuildReady.failedStage}.`
        );
        return;
      }

      const listenerAttached = this.setupEvenHubEventListener();
      if (!listenerAttached) {
        this.markStartupBlocked(
          'listener_attach_failed',
          'Input listener attachment failed after rebuild.'
        );
        await this.shutdownPartiallyStartedPage('startup-listener-attach-failed');
        return;
      }

      this.setupStoreAudioLifecycle();
      this.store.setEvenStartupReady();
      this.store.setStarted(true);
      this.store.log('Startup lifecycle complete: rebuild flow ready.');
      this.syncNeedsForcedImages = true;
      this.queueSyncFromState();
    } catch (error) {
      const errorMessage = String(error);
      this.store.log(`Start error: ${errorMessage}`);
      this.markStartupBlocked('startup_exception', errorMessage);
    }
  }

  private markStartupBlocked(code: EvenStartupBlockedCode, message: string) {
    this.store.setStarted(false);
    this.store.setDeviceLifecycleState('unknown');
    this.store.setEvenStartupBlocked(code, message);
    this.store.log(`Even startup blocked (${code}): ${message}`);
  }

  private async runStartupRebuildFlow(labelPrefix: 'startup' | 'startup-recovery') {
    if (!this.startupLifecycle) {
      return {
        ok: false as const,
        failedStage: 'missing-lifecycle',
      };
    }

    this.store.log('Rebuild step A: compact two-text layout.');
    const twoTextOk = await this.startupLifecycle.attemptRebuild(
      `${labelPrefix}:two-text`,
      this.glasses.buildTextOnlyRebuildContainer()
    );
    if (!twoTextOk) {
      this.store.log(`Startup rebuild failed at two-text stage (${labelPrefix}).`);
      return { ok: false as const, failedStage: 'two-text' as const };
    }

    this.store.log('Rebuild step B: compact codec layout with portrait + action text.');
    const fullRebuildOk = await this.startupLifecycle.attemptRebuild(
      `${labelPrefix}:full-with-portrait`,
      this.glasses.buildRebuildContainer()
    );
    if (!fullRebuildOk) {
      this.store.log(`Startup rebuild failed at full layout stage (${labelPrefix}).`);
      return { ok: false as const, failedStage: 'full-layout' as const };
    }

    return { ok: true as const, failedStage: null };
  }

  private async recoverFromStaleActiveAndRetryOnce() {
    if (!this.startupLifecycle) {
      return {
        ok: false as const,
        failedStage: 'missing-lifecycle',
      };
    }

    this.store.setDeviceLifecycleState('unknown');
    await this.startupLifecycle.shutdown('startup-stale-recovery');
    await this.startupLifecycle.waitAfterShutdown();

    const startupCreateResult = await this.startupLifecycle.attemptStartupCreate(
      'startup-stale-recovery:minimal-single-text',
      this.glasses.buildMinimalStartContainer()
    );
    if (startupCreateResult !== 0) {
      this.store.log(`Startup stale-active recovery create failed with result ${startupCreateResult}.`);
      return { ok: false as const, failedStage: 'recovery-create' as const };
    }

    return this.runStartupRebuildFlow('startup-recovery');
  }

  private async shutdownPartiallyStartedPage(reason: string) {
    if (!this.startupLifecycle) {
      return;
    }

    if (this.unsubscribeEvenHubEvents) {
      this.unsubscribeEvenHubEvents();
      this.unsubscribeEvenHubEvents = null;
    }

    if (this.feedbackManager) {
      this.feedbackManager.dispose();
      this.feedbackManager = null;
    }

    this.store.setStarted(false);
    this.store.setDeviceLifecycleState('unknown');
    await this.startupLifecycle.shutdown(reason).catch((error) => {
      this.store.log(`Partial-start shutdown failed (${reason}): ${String(error)}`);
    });
    this.store.setDeviceLifecycleState('unknown');
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
    this.scheduleSync(false);
  }

  private scheduleSync(forceImages: boolean) {
    if (forceImages) {
      this.syncNeedsForcedImages = true;
    }

    if (this.syncInFlight) {
      this.syncQueuedWhileInFlight = true;
      return;
    }

    if (this.glassesSyncTimer !== null) {
      return;
    }

    this.glassesSyncTimer = window.setTimeout(() => {
      this.glassesSyncTimer = null;
      void this.flushSyncQueue();
    }, this.syncDebounceMs);
  }

  private async flushSyncQueue() {
    if (this.syncInFlight) {
      this.syncQueuedWhileInFlight = true;
      return;
    }

    this.syncInFlight = true;
    try {
      do {
        this.syncQueuedWhileInFlight = false;
        const forceImages = this.syncNeedsForcedImages;
        this.syncNeedsForcedImages = false;
        await this.syncNow(forceImages);
      } while (this.syncQueuedWhileInFlight);
    } finally {
      this.syncInFlight = false;
    }
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
    this.syncInFlight = false;
    this.syncQueuedWhileInFlight = false;
    this.syncNeedsForcedImages = false;

    this.normalizer.clear();
    this.imageQueue?.reset();
    this.lastRenderedPortraitAsset = null;
    this.lastSyncedTextContent = '';
    this.lastSyncSignature = '';
    this.audioCapture.clearBuffer();
    this.previousObservedState = null;
    this.pendingCleanupReason = null;
    this.clearPendingPartialFlush('cleanup');
    this.clearSttRetryTimer('cleanup');

    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }

    void this.stopSttIfNeeded('cleanup');
    void this.closeMicIfNeeded('cleanup');
    this.store.noteCleanup('cleanup');
  }

  private setupEvenHubEventListener() {
    if (!this.bridge) {
      return false;
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

    try {
      this.unsubscribeEvenHubEvents = this.bridge.onEvenHubEvent((event) => {
        this.handleEvenHubEvent(event);
      });
    } catch (error) {
      this.store.log(`Input listener attach failed: ${String(error)}`);
      this.unsubscribeEvenHubEvents = null;
      return false;
    }

    this.store.log('Input listener ready (UP/DOWN/TAP/DOUBLE TAP).');
    return true;
  }

  private setupStoreAudioLifecycle() {
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }

    this.previousObservedState = null;
    this.unsubscribeStore = this.store.subscribe((nextState) => {
      this.captureCleanupReasonHint(nextState);
      void this.syncMicForCurrentState();
    });

    void this.syncMicForCurrentState();
  }

  private async syncMicForCurrentState() {
    if (!this.bridge) {
      return;
    }

    const state = this.store.getState();
    const shouldBeOpen = state.started && state.screen === 'listening';
    if (shouldBeOpen) {
      if (!this.audioCapture.isMicOpen() && state.audioCaptureStatus !== 'opening') {
        this.pendingCleanupReason = null;
        this.store.setAudioCaptureStatus('opening', { micOpen: false, error: null });
        this.store.log('Mic open requested (entered listening).');
        const opened = await this.audioCapture.requestMicOpen(this.bridge);
        const afterOpenState = this.store.getState();
        const stillShouldBeOpen = afterOpenState.started && afterOpenState.screen === 'listening';
        if (!stillShouldBeOpen) {
          this.store.log('Mic open completed after listening exit; closing mic for reconciliation.');
          await this.closeMicIfNeeded('post-open-reconcile');
          return;
        }

        this.store.setAudioCaptureStatus(opened.status, { micOpen: opened.micOpen, error: opened.error });
        this.store.log(opened.ok ? 'Mic open success.' : `Mic open failed: ${opened.error ?? 'unknown error'}`);
      }

      await this.ensureSttForCurrentState();
      return;
    }

    const cleanupReason = this.consumeCleanupReasonHint(state);
    await this.stopSttIfNeeded(cleanupReason);
    await this.closeMicIfNeeded(cleanupReason);
    this.store.noteCleanup(cleanupReason);
  }

  private async closeMicIfNeeded(reason: string) {
    if (!this.bridge || !this.audioCapture.isMicOpen()) {
      if (this.store.getState().micOpen || this.store.getState().audioCaptureStatus !== 'idle') {
        this.store.setAudioCaptureStatus('idle', { micOpen: false, error: null });
      }
      return;
    }

    if (this.store.getState().audioCaptureStatus === 'closing') {
      return;
    }

    this.store.setAudioCaptureStatus('closing', { micOpen: true, error: null });
    this.store.log(`Mic close requested (${reason}).`);
    const closed = await this.audioCapture.requestMicClose(this.bridge);
    this.store.setAudioCaptureStatus(closed.status, { micOpen: closed.micOpen, error: closed.error });
    this.store.log(closed.ok ? `Mic close success (${reason}).` : `Mic close failed (${reason}): ${closed.error ?? 'unknown error'}`);
  }

  private async requestClose() {
    if (!this.startupLifecycle) {
      return;
    }

    await this.stopSttIfNeeded('close-request');
    await this.closeMicIfNeeded('close-request');
    await this.startupLifecycle.shutdown('close-request').catch((error) => {
      this.store.log(`Close request failed: ${String(error)}`);
    });
    this.store.setStarted(false);
    this.store.noteCleanup('close-request');
  }

  private handleEvenHubEvent(event: EvenHubEvent) {
    if (event.audioEvent?.audioPcm) {
      this.handleAudioEvent(event);
    }

    if (!event.listEvent && !event.textEvent && !event.sysEvent) {
      return;
    }

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

  private handleAudioEvent(event: EvenHubEvent) {
    const audioPcm = event.audioEvent?.audioPcm;
    if (!audioPcm) {
      return;
    }

    const state = this.store.getState();
    if (state.screen !== 'listening' || !state.started) {
      const now = Date.now();
      if (now - this.lastAudioDropLogAt >= this.audioDropLogThrottleMs) {
        this.lastAudioDropLogAt = now;
        this.store.log(`Audio frame dropped (screen=${state.screen}, started=${state.started ? 'yes' : 'no'}).`);
      }
      return;
    }

    const metrics = this.audioCapture.ingestAudioEvent(event);
    if (!metrics) {
      return;
    }

    const now = Date.now();
    if (
      this.lastAudioMetricPushAt === 0 ||
      now - this.lastAudioMetricPushAt >= this.audioMetricThrottleMs ||
      metrics.audioFrameCount <= 1
    ) {
      this.lastAudioMetricPushAt = now;
      this.store.updateAudioCaptureMetrics(metrics);
    }
    if (state.audioCaptureStatus !== 'listening' || !state.micOpen) {
      this.store.setAudioCaptureStatus('listening', { micOpen: true, error: null });
    }

    const sttSession = this.sttSession;
    const sttSessionToken = this.activeSttSessionToken;
    if (
      sttSession &&
      sttSessionToken !== null &&
      this.activeSttListeningSessionId !== null &&
      this.canApplySttCallback(
        this.activeSttListeningSessionId,
        sttSessionToken,
        sttSession,
        'audio-send'
      )
    ) {
      void sttSession.sendAudio(audioPcm).catch((error) => {
        this.store.log(`STT audio send failed: ${String(error)}`);
      });
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
      const text = this.glasses.getDialogueText();
      if (text === this.lastSyncedTextContent) {
        return;
      }

      const dialogueUpdate = {
        containerID: GLASSES_CONTAINERS.dialogueText.id,
        containerName: GLASSES_CONTAINERS.dialogueText.name,
        contentOffset: 0,
        contentLength: 1000,
        content: text,
      };

      const ok = await this.bridge.textContainerUpgrade(dialogueUpdate as any);
      if (ok) {
        this.lastSyncedTextContent = text;
      }
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
      listeningActionIndex: state.listeningActionIndex,
      activeActionIndex: state.activeActionIndex,
      endedActionIndex: state.endedActionIndex,
      dialogueIndex: state.dialogueIndex,
      activeTranscriptCursor: state.activeTranscriptCursor,
      transcriptTailIdBucket: state.transcript.length > 0 ? state.transcript[state.transcript.length - 1]?.id ?? null : null,
      turnState: state.turnState,
      lastHandledUserTranscriptId: state.lastHandledUserTranscriptId,
      pendingResponseId: state.pendingResponseId,
      responseError: state.responseError,
      responseStatusTimestampBucket: state.responseStatusTimestamp ? Math.floor(state.responseStatusTimestamp / 1000) : null,
      micOpen: state.micOpen,
      audioCaptureStatus: state.audioCaptureStatus,
      sttStatus: state.sttStatus,
      sttPartialBucket: state.sttPartialTranscript ? state.sttPartialTranscript.slice(0, 64) : null,
      sttError: state.sttError,
      audioDurationBucket: Math.floor(state.bufferedAudioDurationMs / 500),
      activityBucket: Math.floor(state.listeningActivityLevel * 10),
      frameAtBucket: state.lastAudioFrameAt ? Math.floor(state.lastAudioFrameAt / 1000) : null,
      lastNormalizedInput: state.lastNormalizedInput,
      lastRawEventType: state.lastRawEvent?.rawEventTypeName ?? null,
    });
  }

  private async ensureSttForCurrentState() {
    const state = this.store.getState();
    if (!state.started || state.screen !== 'listening') {
      return;
    }

    if (state.sttStatus === 'error') {
      return;
    }

    if (!state.micOpen || state.audioCaptureStatus !== 'listening' || !this.audioCapture.isMicOpen()) {
      return;
    }

    if (this.activeSttListeningSessionId !== null && this.activeSttListeningSessionId !== state.listeningSessionId) {
      await this.stopSttIfNeeded('session-rollover');
    }

    if (this.sttReconnectAttemptedSessionId !== null && this.sttReconnectAttemptedSessionId !== state.listeningSessionId) {
      this.sttReconnectAttemptedSessionId = null;
      this.store.setReliabilityDebug({ sttReconnectAttemptedSessionId: null });
    }

    if (this.sttSession) {
      return;
    }

    await this.startSttSessionForListening(state.listeningSessionId, false);
  }

  private async startSttSessionForListening(listeningSessionId: number, isRetry: boolean) {
    this.clearSttRetryTimer('start-session');

    const state = this.store.getState();
    if (!state.started || state.screen !== 'listening' || state.listeningSessionId !== listeningSessionId) {
      return;
    }

    if (!state.micOpen || state.audioCaptureStatus !== 'listening' || !this.audioCapture.isMicOpen()) {
      return;
    }

    this.logSttEvent('stt_auth_requested', { listeningSessionId, retry: isRetry });

    let accessToken = '';
    try {
      const auth = await requestSttBrokerAuth();
      accessToken = auth.accessToken;
      this.logSttEvent('stt_auth_succeeded', { listeningSessionId, retry: isRetry });
    } catch (error) {
      const appError = this.toAppError(error, {
        category: 'auth_error',
        code: 'stt_auth_unavailable',
        userMessage: 'Unable to start speech session because auth is unavailable.',
      });
      this.recordSttError(appError);
      this.logSttEvent('stt_auth_failed', {
        listeningSessionId,
        retry: isRetry,
        category: appError.category,
        code: appError.code,
      });

      if (!isRetry && this.sttReconnectAttemptedSessionId !== listeningSessionId) {
        await this.scheduleSttRetryAfterFailure(listeningSessionId, appError);
        return;
      }

      this.store.setSttStatus('error', { error: appError.userMessage });
      return;
    }

    const session = new DeepgramStreamingSttSession({ accessToken });
    const sttSessionToken = this.nextSttSessionToken++;
    this.sttSession = session;
    this.activeSttListeningSessionId = listeningSessionId;
    this.activeSttSessionToken = sttSessionToken;
    this.lastCommittedFinal = null;
    this.clearPendingPartialFlush('new-session');
    this.store.setSttStatus('connecting', { error: null });
    this.store.setReliabilityDebug({
      activeSttSessionToken: sttSessionToken,
      activeSttListeningSessionId: listeningSessionId,
      sttReconnectAttemptedSessionId: this.sttReconnectAttemptedSessionId,
      sttRetryScheduledForSessionId: null,
      sttRetryScheduledAt: null,
      pendingPartialFlush: false,
    });

    session.onStateChange((nextState) => {
      if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'state-change')) {
        return;
      }

      if (nextState === 'error') {
        this.clearPendingPartialFlush('stt-state-error');
        this.store.clearSttPartialTranscript();
      }
      this.store.setSttStatus(nextState, nextState === 'error' ? { error: 'STT stream entered error state.' } : { error: null });
    });

    session.onPartial((text) => {
      if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'partial')) {
        return;
      }

      this.queuePartialTranscriptFlush(text, listeningSessionId, sttSessionToken, session);
    });

    session.onFinal((text) => {
      if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'final')) {
        return;
      }

      this.clearPendingPartialFlush('stt-final');
      this.commitSttFinal(sttSessionToken, text);
    });

    session.onError((error) => {
      if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'error')) {
        return;
      }

      void this.handleSttErrorForSession(listeningSessionId, sttSessionToken, session, error);
    });

    try {
      await session.start();
      if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'post-start-reconcile')) {
        await this.stopSttIfNeeded('post-start-reconcile');
      }
    } catch (error) {
      if (this.sttSession === session) {
        this.sttSession = null;
        this.activeSttListeningSessionId = null;
        this.activeSttSessionToken = null;
        this.store.setReliabilityDebug({
          activeSttSessionToken: null,
          activeSttListeningSessionId: null,
          pendingPartialFlush: false,
        });
      }
      const appError = this.toAppError(error, {
        category: 'stt_error',
        code: 'stt_start_failed',
        userMessage: 'Unable to start speech stream.',
      });
      this.recordSttError(appError);
      this.logSttEvent('stt_start_failed', {
        listeningSessionId,
        retry: isRetry,
        category: appError.category,
        code: appError.code,
      });
      if (!this.isListeningSessionActive(listeningSessionId)) {
        return;
      }

      if (!isRetry && this.sttReconnectAttemptedSessionId !== listeningSessionId) {
        await this.handleSttErrorForSession(listeningSessionId, sttSessionToken, session, appError.userMessage);
        return;
      }

      this.store.setSttStatus('error', { error: appError.userMessage });
    }
  }

  private async stopSttIfNeeded(reason: string) {
    this.clearSttRetryTimer(reason);
    this.clearPendingPartialFlush(reason);
    if (!reason.includes('stt-retry')) {
      this.sttReconnectAttemptedSessionId = null;
      this.store.setReliabilityDebug({ sttReconnectAttemptedSessionId: null });
    }

    if (!this.sttSession) {
      if (this.store.getState().sttStatus !== 'idle' || this.store.getState().sttPartialTranscript) {
        this.store.clearSttPartialTranscript();
        this.store.setSttStatus('idle', { error: null });
      }
      this.activeSttListeningSessionId = null;
      this.activeSttSessionToken = null;
      this.lastCommittedFinal = null;
      this.store.setReliabilityDebug({
        activeSttSessionToken: null,
        activeSttListeningSessionId: null,
        pendingPartialFlush: false,
      });
      return;
    }

    this.store.clearSttPartialTranscript();
    this.store.setSttStatus('closing', { error: null });
    this.store.log(`STT close requested (${reason}).`);
    const session = this.sttSession;
    this.sttSession = null;
    this.activeSttListeningSessionId = null;
    this.activeSttSessionToken = null;
    this.lastCommittedFinal = null;
    this.store.setReliabilityDebug({
      activeSttSessionToken: null,
      activeSttListeningSessionId: null,
      pendingPartialFlush: false,
    });

    try {
      await session.stop();
      this.store.setSttStatus('idle', { error: null });
      this.store.log(`STT close success (${reason}).`);
    } catch (error) {
      this.store.setSttStatus('error', { error: `STT close failed: ${String(error)}` });
      this.store.log(`STT close failed (${reason}): ${String(error)}`);
    }
  }

  private clearSttRetryTimer(reason = 'cancelled') {
    if (this.sttRetryTimer === null) {
      return;
    }

    window.clearTimeout(this.sttRetryTimer);
    this.sttRetryTimer = null;
    const now = Date.now();
    this.store.log(`STT retry cancelled (${reason}).`);
    this.store.setReliabilityDebug({
      sttRetryScheduledForSessionId: null,
      sttRetryScheduledAt: null,
      sttRetryCancelledAt: now,
    });
  }

  private isListeningSessionActive(listeningSessionId: number) {
    const state = this.store.getState();
    return (
      state.started &&
      state.screen === 'listening' &&
      state.listeningSessionId === listeningSessionId
    );
  }

  private canApplySttCallback(
    listeningSessionId: number,
    sttSessionToken: number,
    session: StreamingSttSession,
    callbackKind: string
  ) {
    if (!this.isListeningSessionActive(listeningSessionId)) {
      this.noteStaleCallback(`stt:${callbackKind}`, `listening_session_inactive:${listeningSessionId}`);
      return false;
    }

    if (this.activeSttListeningSessionId !== listeningSessionId) {
      this.noteStaleCallback(`stt:${callbackKind}`, `active_session_mismatch:${listeningSessionId}`);
      return false;
    }

    if (this.activeSttSessionToken !== sttSessionToken) {
      this.noteStaleCallback(`stt:${callbackKind}`, `session_token_mismatch:${sttSessionToken}`);
      return false;
    }

    if (this.sttSession !== session) {
      this.noteStaleCallback(`stt:${callbackKind}`, 'session_instance_mismatch');
      return false;
    }

    return true;
  }

  private commitSttFinal(sttSessionToken: number, text: string) {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    const now = Date.now();
    const dedupeText = normalized.toLowerCase();
    if (
      this.lastCommittedFinal &&
      this.lastCommittedFinal.sessionToken === sttSessionToken &&
      this.lastCommittedFinal.text === dedupeText &&
      now - this.lastCommittedFinal.at <= this.sttAdjacentFinalDedupeWindowMs
    ) {
      return;
    }

    const committed = this.store.commitUserFinalTranscript(normalized, {
      speaker: 'YOU',
      contactName: this.currentContactName(),
    });
    if (!committed) {
      return;
    }

    this.lastCommittedFinal = {
      sessionToken: sttSessionToken,
      text: dedupeText,
      at: now,
    };
  }

  private async handleSttErrorForSession(
    listeningSessionId: number,
    sttSessionToken: number,
    session: StreamingSttSession,
    error: string
  ) {
    if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'error-handler')) {
      return;
    }

    this.clearPendingPartialFlush('stt-error');
    this.store.clearSttPartialTranscript();

    const appError = this.toAppError(error, {
      category: 'stt_error',
      code: 'stt_stream_error',
      userMessage: 'Speech stream encountered an error.',
    });
    this.recordSttError(appError);

    if (this.sttReconnectAttemptedSessionId === listeningSessionId) {
      this.store.setSttStatus('error', { error: appError.userMessage });
      return;
    }

    this.sttReconnectAttemptedSessionId = listeningSessionId;
    this.store.setReliabilityDebug({ sttReconnectAttemptedSessionId: listeningSessionId });
    this.logSttEvent('stt_error_retrying', { category: appError.category, code: appError.code, listeningSessionId });
    await this.stopSttIfNeeded('stt-retry');
    if (!this.isListeningSessionActive(listeningSessionId)) {
      return;
    }

    this.clearSttRetryTimer('reschedule');
    const scheduledAt = Date.now();
    this.store.setReliabilityDebug({
      sttRetryScheduledForSessionId: listeningSessionId,
      sttRetryScheduledAt: scheduledAt,
      sttRetryCancelledAt: null,
    });
    this.logSttEvent('stt_retry_scheduled', { listeningSessionId, delayMs: this.sttRetryDelayMs });
    this.sttRetryTimer = window.setTimeout(() => {
      this.sttRetryTimer = null;
      this.store.setReliabilityDebug({
        sttRetryScheduledForSessionId: null,
        sttRetryScheduledAt: null,
      });
      if (!this.isListeningSessionActive(listeningSessionId) || this.sttSession) {
        this.noteStaleCallback('stt:retry-fire', `retry_target_invalid:${listeningSessionId}`);
        return;
      }

      void this.startSttSessionForListening(listeningSessionId, true);
    }, this.sttRetryDelayMs);
  }

  private queuePartialTranscriptFlush(
    text: string,
    listeningSessionId: number,
    sttSessionToken: number,
    session: StreamingSttSession
  ) {
    this.pendingPartialText = text;
    this.pendingPartialListeningSessionId = listeningSessionId;
    this.pendingPartialSessionToken = sttSessionToken;
    this.pendingPartialSessionRef = session;
    this.store.setReliabilityDebug({ pendingPartialFlush: true });

    if (this.pendingPartialFlushTimer !== null) {
      return;
    }

    this.pendingPartialFlushTimer = window.setTimeout(() => {
      this.pendingPartialFlushTimer = null;
      const nextText = this.pendingPartialText;
      const nextSessionId = this.pendingPartialListeningSessionId;
      const nextToken = this.pendingPartialSessionToken;
      const nextSession = this.pendingPartialSessionRef;
      this.pendingPartialText = null;
      this.pendingPartialListeningSessionId = null;
      this.pendingPartialSessionToken = null;
      this.pendingPartialSessionRef = null;
      this.store.setReliabilityDebug({ pendingPartialFlush: false });

      if (
        !nextText ||
        nextSessionId === null ||
        nextToken === null ||
        !nextSession ||
        !this.canApplySttCallback(nextSessionId, nextToken, nextSession, 'partial-flush')
      ) {
        return;
      }

      this.store.setSttPartialTranscript(nextText);
    }, this.sttPartialFlushMs);
  }

  private clearPendingPartialFlush(_reason: string) {
    if (this.pendingPartialFlushTimer !== null) {
      window.clearTimeout(this.pendingPartialFlushTimer);
      this.pendingPartialFlushTimer = null;
    }

    const hadPending =
      this.pendingPartialText !== null ||
      this.pendingPartialListeningSessionId !== null ||
      this.pendingPartialSessionToken !== null ||
      this.pendingPartialSessionRef !== null;
    this.pendingPartialText = null;
    this.pendingPartialListeningSessionId = null;
    this.pendingPartialSessionToken = null;
    this.pendingPartialSessionRef = null;

    if (hadPending) {
      this.store.setReliabilityDebug({ pendingPartialFlush: false });
      return;
    }

    this.store.setReliabilityDebug({ pendingPartialFlush: false });
  }

  private captureCleanupReasonHint(nextState: ReturnType<AppStore['getState']>) {
    const previous = this.previousObservedState;
    this.previousObservedState = {
      screen: nextState.screen,
      selectedContactIndex: nextState.selectedContactIndex,
      started: nextState.started,
    };

    if (!previous) {
      return;
    }

    if (previous.started && !nextState.started) {
      this.pendingCleanupReason = 'shutdown';
      return;
    }

    if (previous.selectedContactIndex !== nextState.selectedContactIndex) {
      this.pendingCleanupReason = 'contact_change';
      return;
    }

    if (previous.screen === 'listening' && nextState.screen === 'active') {
      this.pendingCleanupReason = 'continue';
      return;
    }

    if (previous.screen === 'listening' && nextState.screen === 'ended') {
      this.pendingCleanupReason = 'end';
      return;
    }

    if (previous.screen === 'incoming' && nextState.screen === 'ended') {
      this.pendingCleanupReason = 'ignore';
      return;
    }

    if (previous.screen === 'ended' && nextState.screen === 'contacts') {
      this.pendingCleanupReason = 'back';
    }
  }

  private consumeCleanupReasonHint(state: ReturnType<AppStore['getState']>) {
    const reason = this.pendingCleanupReason ?? 'state-sync';
    this.pendingCleanupReason = null;
    return `${reason}:${state.screen}`;
  }

  private noteStaleCallback(kind: string, reason: string) {
    const now = Date.now();
    const key = `${kind}:${reason}`;
    if (this.lastStaleNote && this.lastStaleNote.key === key && now - this.lastStaleNote.at < this.staleLogCooldownMs) {
      return;
    }

    this.lastStaleNote = { key, at: now };
    const descriptor = `${kind}/${reason}`;
    this.store.noteIgnoredStaleCallback(descriptor);
    this.logSttEvent('stale_callback_ignored', { descriptor });
  }

  private toAppError(
    error: unknown,
    fallback: { category: ErrorCategory; code: string; userMessage: string }
  ): AppError {
    if (isAppError(error)) {
      return error;
    }

    return createAppError({
      category: fallback.category,
      code: fallback.code,
      userMessage: fallback.userMessage,
      detail: redactSensitiveText(toErrorMessage(error)),
    });
  }

  private recordSttError(error: AppError) {
    this.store.setReliabilityDebug({
      lastErrorCategory: error.category,
      lastErrorCode: error.code,
    });
  }

  private logSttEvent(event: string, details?: Record<string, unknown>) {
    const detailPairs = details
      ? Object.entries(details)
          .map(([key, value]) => `${key}=${redactSensitiveText(String(value))}`)
          .join(', ')
      : '';
    this.store.log(detailPairs ? `STT ${event} (${detailPairs})` : `STT ${event}.`);
  }

  private async scheduleSttRetryAfterFailure(listeningSessionId: number, error: AppError) {
    this.sttReconnectAttemptedSessionId = listeningSessionId;
    this.store.setReliabilityDebug({
      sttReconnectAttemptedSessionId: listeningSessionId,
      lastErrorCategory: error.category,
      lastErrorCode: error.code,
    });
    await this.stopSttIfNeeded('stt-retry');
    if (!this.isListeningSessionActive(listeningSessionId)) {
      return;
    }

    this.clearSttRetryTimer('reschedule');
    const scheduledAt = Date.now();
    this.store.setReliabilityDebug({
      sttRetryScheduledForSessionId: listeningSessionId,
      sttRetryScheduledAt: scheduledAt,
      sttRetryCancelledAt: null,
    });
    this.logSttEvent('stt_retry_scheduled', { listeningSessionId, delayMs: this.sttRetryDelayMs, reason: error.code });
    this.sttRetryTimer = window.setTimeout(() => {
      this.sttRetryTimer = null;
      this.store.setReliabilityDebug({
        sttRetryScheduledForSessionId: null,
        sttRetryScheduledAt: null,
      });
      if (!this.isListeningSessionActive(listeningSessionId) || this.sttSession) {
        this.noteStaleCallback('stt:retry-fire', `retry_target_invalid:${listeningSessionId}`);
        return;
      }

      void this.startSttSessionForListening(listeningSessionId, true);
    }, this.sttRetryDelayMs);
  }

  private currentContactName() {
    const state = this.store.getState();
    return CONTACTS[state.selectedContactIndex]?.name ?? 'Unknown';
  }
}

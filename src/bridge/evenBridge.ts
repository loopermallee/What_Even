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
import { AudioCaptureController, DEBUG_STT_COUNTDOWN } from './audio';
import { DeepgramStreamingSttSession, type StreamingSttSession } from './stt';
import { createAppError, isAppError, redactSensitiveText, toErrorMessage, type AppError } from '../app/errors';
import type { ErrorCategory, EvenStartupBlockedCode, NormalizedInput, RawEventDebugInfo } from '../app/types';
import { requestSttBrokerAuth } from './sttAuth';
import { hasEvenNativeHost } from './nativeHost';

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

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function isSimulatorIdentityUser(user: unknown) {
  if (!user || typeof user !== 'object') {
    return false;
  }

  const candidate = user as { name?: unknown; uid?: unknown };
  return candidate.name === 'Simulator' || String(candidate.uid ?? '') === '1337';
}

function detectSimulatorSession(user: unknown, device: unknown) {
  const userInfo = user && typeof user === 'object' ? user as { name?: unknown; uid?: unknown } : null;
  const deviceInfo = device && typeof device === 'object'
    ? device as { sn?: unknown; status?: { connectType?: unknown } | null }
    : null;

  const userNameIsSimulator = userInfo?.name === 'Simulator';
  const userUidIsSimulator = String(userInfo?.uid ?? '') === '1337';
  const deviceSnIsSimulator = deviceInfo?.sn === 'S2001234567890';
  const connectTypeIsConnected = deviceInfo?.status?.connectType === 'connected';

  const detected =
    deviceSnIsSimulator
    || (userNameIsSimulator && userUidIsSimulator)
    || (connectTypeIsConnected && isSimulatorIdentityUser(user));

  const reasons: string[] = [];
  if (userNameIsSimulator) {
    reasons.push('user.name=Simulator');
  }
  if (userUidIsSimulator) {
    reasons.push('user.uid=1337');
  }
  if (deviceSnIsSimulator) {
    reasons.push('device.sn=S2001234567890');
  }
  if (connectTypeIsConnected && reasons.length > 0) {
    reasons.push('device.status.connectType=connected');
  }

  return { detected, reasons };
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
  private unsubscribeLaunchSource: (() => void) | null = null;
  private unsubscribeDeviceStatusChanged: (() => void) | null = null;
  private unsubscribeEvenHubEvents: (() => void) | null = null;
  private feedbackManager: InteractionFeedbackManager | null = null;
  private normalizer = new EvenInputNormalizer();
  private imageQueue: SerializedImageQueue | null = null;
  private startupLifecycle: StartupLifecycleManager | null = null;
  private glassesSyncTimer: number | null = null;
  private cursorBlinkTimer: number | null = null;
  private draftVisibilityTimer: number | null = null;
  private syncInFlight = false;
  private syncQueuedWhileInFlight = false;
  private syncNeedsForcedImages = false;
  private lastRenderedPortraitAsset: string | null = null;
  private lastQueuedPortraitAsset: string | null = null;
  private lastPortraitSyncAt: number | null = null;
  private lastSyncedTextContent = '';
  private lastRebuildSignature = '';
  private lastSyncSignature = '';
  private lastQueuedScreen: string | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private previousObservedState: { screen: string; selectedContactIndex: number; started: boolean } | null = null;
  private lastAudioLifecycleSignature = '';
  private pendingCleanupReason: CleanupReason | null = null;
  private readonly audioCapture = new AudioCaptureController({ maxBufferDurationMs: 10_000 });
  private sttSession: StreamingSttSession | null = null;
  private activeSttListeningSessionId: number | null = null;
  private activeSttSessionToken: number | null = null;
  private sttStartInFlightListeningSessionId: number | null = null;
  private sttStartInFlightAttemptToken: number | null = null;
  private nextSttStartAttemptToken = 1;
  private nextSttSessionToken = 1;
  private sttReconnectAttemptedSessionId: number | null = null;
  private sttRetryTimer: number | null = null;
  private lastCommittedFinal: { sessionToken: number; text: string; at: number } | null = null;
  private pendingPartialFlushTimer: number | null = null;
  private pendingPartialText: string | null = null;
  private pendingPartialSessionToken: number | null = null;
  private pendingPartialListeningSessionId: number | null = null;
  private pendingPartialSessionRef: StreamingSttSession | null = null;
  private sttStopInFlight: Promise<void> | null = null;
  private lastAudioMetricPushAt = 0;
  private lastAudioDropLogAt = 0;
  private lastStaleNote: { key: string; at: number } | null = null;
  private readonly sttRetryDelayMs = 350;
  private readonly sttAdjacentFinalDedupeWindowMs = 1200;
  private readonly syncDebounceMs = 70;
  private readonly portraitSyncCooldownMs = 600;
  private readonly audioMetricThrottleMs = 90;
  private readonly audioDropLogThrottleMs = 1500;
  private readonly sttPartialFlushMs = 70;
  private readonly staleLogCooldownMs = 800;
  private readonly outboundAdvanceDelayMs = 1100;
  private readonly maxCaptureDurationMs = 10_000;
  private readonly simulatorUnknownTapSuppressMs = 150;
  private readonly deviceInfoRetryDelayMs = 250;
  private readonly deviceInfoRetryAttempts = 4;
  private readonly extendedDeviceObservationMs = 4_000;
  private readonly extendedDeviceObservationPollMs = 500;
  private suppressSimulatorUnknownTapUntil = 0;
  private bridgeReadyAt: number | null = null;
  private portraitCooldownTimer: number | null = null;
  private outboundAdvanceTimer: number | null = null;
  private sawLaunchSourceCallback = false;
  private latestLaunchSource: string | null = null;
  private firstLaunchSourceCallbackAt: number | null = null;
  private sawDeviceStatusCallback = false;
  private firstDeviceStatusCallbackAt: number | null = null;
  private latestDeviceStatusSnapshot: unknown = null;
  private latestDeviceStatusConnectType: string | null = null;
  private firstNonNullDeviceInfoAt: number | null = null;

  constructor(store: AppStore, glasses: AppGlasses) {
    this.store = store;
    this.glasses = glasses;
  }

  async startOnEven(options?: { forceReset?: boolean }) {
    const nativeHostDetected = hasEvenNativeHost();
    const preStartState = this.store.getState();
    if (!preStartState.started && preStartState.screen === 'ended') {
      this.store.backToContacts();
      this.store.log('Reset stale ended screen to contacts baseline before startup.');
    }
    this.store.setEvenNativeHostDetected(nativeHostDetected);
    this.store.log(`Debug: native host detected = ${nativeHostDetected}`);
    if (!nativeHostDetected) {
      this.store.setStarted(false);
      this.store.log('Even native host not detected; skipping glasses startup.');
      this.store.log('Bridge/session diagnostics skipped because the Even native host is missing.');
      this.store.setEvenStartupBlocked(
        'native_host_missing',
        'Glasses startup only works inside the Even app native host.'
      );
      return;
    }

    this.store.log('Waiting for Even bridge...');
    this.store.setEvenStartupStarting();
    this.store.setStarted(false);

    try {
      this.bridge = await waitForEvenAppBridge();
      this.bridgeReadyAt = Date.now();
      this.sawLaunchSourceCallback = false;
      this.latestLaunchSource = null;
      this.firstLaunchSourceCallbackAt = null;
      this.sawDeviceStatusCallback = false;
      this.firstDeviceStatusCallbackAt = null;
      this.latestDeviceStatusSnapshot = null;
      this.latestDeviceStatusConnectType = null;
      this.firstNonNullDeviceInfoAt = null;
      this.store.log('Bridge connected.');
      this.store.log('Debug: bridge connected = true');
      this.attachLaunchSourceDiagnostics();
      this.attachDeviceStatusDiagnostics();

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

      const user = await this.bridge.getUserInfo().catch((error) => {
        this.store.log(`User info request failed: ${String(error)}`);
        return null;
      });
      this.store.log(`Debug: user info result = ${safeSerialize(user)}`);

      if (user) {
        this.store.log(`User: ${user.name || '(blank name)'}`);
      } else {
        this.store.log('User info unavailable.');
      }

      const userOnlySimulatorDiagnostic = detectSimulatorSession(user, null);
      this.store.setSimulatorSessionDetected(userOnlySimulatorDiagnostic.detected);
      if (userOnlySimulatorDiagnostic.detected) {
        this.store.log('SIMULATOR SESSION DETECTED — this is not the real glasses.');
        this.store.log(`Simulator diagnostic signatures: ${userOnlySimulatorDiagnostic.reasons.join(', ')}`);
      }

      // Keep session diagnostics running, but don't block the first on-glasses render on device info timing.
      void this.observeDeviceSessionDuringStartup(user, userOnlySimulatorDiagnostic.detected);

      this.logSessionAttachSummary('startup-ready');
      this.store.log('Device/session diagnostics continuing in background; startup page render will proceed without a pre-start device gate.');

      const startupReady = await this.startupLifecycle.ensureStartupPageLifecycle({
        forceReset,
        minimalStartPayload: this.glasses.buildMinimalStartContainer(),
      });

      if (!startupReady.ok) {
        this.store.log('Startup lifecycle failed before rebuild; rebuild/fallback skipped.');
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
      this.lastRebuildSignature = this.glasses.getStructuralRebuildSignature();
      this.store.log('Startup lifecycle complete: rebuild flow ready.');
      this.syncNeedsForcedImages = true;
      this.queueSyncFromState();
    } catch (error) {
      const errorMessage = String(error);
      this.store.log(`Start error: ${errorMessage}`);
      this.markStartupBlocked('startup_exception', errorMessage);
    }
  }

  private async observeDeviceSessionDuringStartup(user: unknown, userOnlySimulatorDetected: boolean) {
    const device = await this.waitForActiveDeviceSession();
    if (!device) {
      this.logSessionAttachSummary('startup-ready');
      this.store.log('Device session diagnostics completed with no active device info; startup was allowed to proceed for first-render testing.');
      return;
    }

    this.store.log(`Device model: ${String(device.model)}`);
    this.store.log(`Device SN: ${device.sn}`);
    this.store.log(`Connect type: ${device.status?.connectType ?? 'unknown'}`);
    this.store.log(`Debug: device info result = ${safeSerialize(device)}`);
    if (device.status?.connectType !== 'connected') {
      this.store.log(`Debug: device session is present with connectType=${device.status?.connectType ?? 'unknown'}.`);
    }

    const simulatorDiagnostic = detectSimulatorSession(user, device);
    this.store.setSimulatorSessionDetected(simulatorDiagnostic.detected);
    if (simulatorDiagnostic.detected && !userOnlySimulatorDetected) {
      this.store.log('SIMULATOR SESSION DETECTED — this is not the real glasses.');
    }
    if (simulatorDiagnostic.detected) {
      this.store.log(`Simulator diagnostic signatures: ${simulatorDiagnostic.reasons.join(', ')}`);
    }

    this.logSessionAttachSummary('startup-ready');
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
      'startup-stale-recovery:minimal-two-text',
      this.glasses.buildMinimalStartContainer()
    );
    if (startupCreateResult !== 0) {
      this.store.log(`Startup stale-active recovery create failed with result ${startupCreateResult}.`);
      return { ok: false as const, failedStage: 'recovery-create' as const };
    }

    return this.runStartupRebuildFlow('startup-recovery');
  }

  private async waitForActiveDeviceSession() {
    if (!this.bridge) {
      return null;
    }

    for (let attempt = 1; attempt <= this.deviceInfoRetryAttempts; attempt += 1) {
      const device = await this.bridge.getDeviceInfo().catch((error) => {
        this.store.log(`Device info request failed on attempt ${attempt}: ${String(error)}`);
        return null;
      });
      this.store.log(`Debug: device info result (attempt ${attempt}/${this.deviceInfoRetryAttempts}) = ${safeSerialize(device)}`);

      if (device) {
        this.noteFirstNonNullDeviceInfo(`initial-gate-attempt-${attempt}`);
        return device;
      }

      if (attempt < this.deviceInfoRetryAttempts) {
        this.store.log(
          `Bridge connected but no active device session. Retrying getDeviceInfo() in ${this.deviceInfoRetryDelayMs}ms (${attempt}/${this.deviceInfoRetryAttempts - 1}).`
        );
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, this.deviceInfoRetryDelayMs);
        });
      }
    }

    this.store.log(
      `Device session gate summary before block: statusCallbackSeen=${this.sawDeviceStatusCallback ? 'yes' : 'no'}, latestConnectType=${this.latestDeviceStatusConnectType ?? 'unknown'}, latestStatusSnapshot=${safeSerialize(this.latestDeviceStatusSnapshot)}`
    );
    await this.runExtendedDeviceObservation();
    this.store.log('Bridge connected but no active device session. Diagnostics complete; startup is allowed to continue.');
    return null;
  }

  private attachLaunchSourceDiagnostics() {
    if (!this.bridge) {
      return;
    }

    if (this.unsubscribeLaunchSource) {
      this.unsubscribeLaunchSource();
      this.unsubscribeLaunchSource = null;
    }

    try {
      this.unsubscribeLaunchSource = this.bridge.onLaunchSource((source) => {
        const normalizedSource = typeof source === 'string' ? source : String(source);
        const isFirstCallback = !this.sawLaunchSourceCallback;
        this.sawLaunchSourceCallback = true;
        this.latestLaunchSource = normalizedSource;
        if (this.firstLaunchSourceCallbackAt === null) {
          this.firstLaunchSourceCallbackAt = Date.now();
        }
        this.store.log(
          `Launch source callback${isFirstCallback ? ' (first)' : ''}: source=${normalizedSource}, elapsedSinceBridge=${this.formatElapsedFromBridge(this.firstLaunchSourceCallbackAt)}`
        );
      });
      this.store.log('Launch source diagnostics listener attached.');
    } catch (error) {
      this.store.log(`Launch source diagnostics listener attach failed: ${String(error)}`);
      this.unsubscribeLaunchSource = null;
    }
  }

  private attachDeviceStatusDiagnostics() {
    if (!this.bridge) {
      return;
    }

    if (this.unsubscribeDeviceStatusChanged) {
      this.unsubscribeDeviceStatusChanged();
      this.unsubscribeDeviceStatusChanged = null;
    }

    try {
      this.unsubscribeDeviceStatusChanged = this.bridge.onDeviceStatusChanged((status) => {
        const now = Date.now();
        const isFirstCallback = !this.sawDeviceStatusCallback;
        this.sawDeviceStatusCallback = true;
        if (this.firstDeviceStatusCallbackAt === null) {
          this.firstDeviceStatusCallbackAt = now;
        }
        this.latestDeviceStatusSnapshot = status;
        this.latestDeviceStatusConnectType =
          typeof status?.connectType === 'string' ? status.connectType : status?.connectType != null ? String(status.connectType) : null;
        this.store.log(
          `Device status callback${isFirstCallback ? ' (first)' : ''}: connectType=${this.latestDeviceStatusConnectType ?? 'unknown'}, batteryLevel=${String(status?.batteryLevel ?? 'unknown')}, isWearing=${String(status?.isWearing ?? 'unknown')}, isCharging=${String(status?.isCharging ?? 'unknown')}, elapsedSinceBridge=${this.formatElapsedFromBridge(this.firstDeviceStatusCallbackAt)}, raw=${safeSerialize(status)}`
        );
      });
      this.store.log('Device status diagnostics listener attached.');
    } catch (error) {
      this.store.log(`Device status diagnostics listener attach failed: ${String(error)}`);
      this.unsubscribeDeviceStatusChanged = null;
    }
  }

  private async shutdownPartiallyStartedPage(reason: string) {
    if (!this.startupLifecycle) {
      return;
    }

    if (this.unsubscribeLaunchSource) {
      this.unsubscribeLaunchSource();
      this.unsubscribeLaunchSource = null;
    }

    if (this.unsubscribeDeviceStatusChanged) {
      this.unsubscribeDeviceStatusChanged();
      this.unsubscribeDeviceStatusChanged = null;
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

    this.refreshCursorBlinkLoop();
    this.refreshDraftVisibilityTimer();

    const screenChanged = this.lastQueuedScreen !== this.store.getState().screen;
    this.lastQueuedScreen = this.store.getState().screen;
    const signature = this.getSyncSignature();
    if (signature === this.lastSyncSignature) {
      return;
    }

    this.lastSyncSignature = signature;
    this.scheduleSync(screenChanged);
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
    if (this.unsubscribeLaunchSource) {
      this.unsubscribeLaunchSource();
      this.unsubscribeLaunchSource = null;
    }

    if (this.unsubscribeDeviceStatusChanged) {
      this.unsubscribeDeviceStatusChanged();
      this.unsubscribeDeviceStatusChanged = null;
    }

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
    if (this.cursorBlinkTimer !== null) {
      window.clearInterval(this.cursorBlinkTimer);
      this.cursorBlinkTimer = null;
    }
    if (this.draftVisibilityTimer !== null) {
      window.clearTimeout(this.draftVisibilityTimer);
      this.draftVisibilityTimer = null;
    }
    if (this.portraitCooldownTimer !== null) {
      window.clearTimeout(this.portraitCooldownTimer);
      this.portraitCooldownTimer = null;
    }
    this.clearOutboundAdvanceTimer();
    this.syncInFlight = false;
    this.syncQueuedWhileInFlight = false;
    this.syncNeedsForcedImages = false;

    this.normalizer.clear();
    this.imageQueue?.reset();
    this.lastRenderedPortraitAsset = null;
    this.lastQueuedPortraitAsset = null;
    this.lastPortraitSyncAt = null;
    this.lastSyncedTextContent = '';
    this.lastRebuildSignature = '';
    this.lastSyncSignature = '';
    this.lastQueuedScreen = null;
    this.lastAudioLifecycleSignature = '';
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

  private async runExtendedDeviceObservation() {
    if (!this.bridge) {
      return;
    }

    const startedAt = Date.now();
    const maxPolls = Math.max(1, Math.ceil(this.extendedDeviceObservationMs / this.extendedDeviceObservationPollMs));
    this.store.log(
      `Extended device observation started for ${this.extendedDeviceObservationMs}ms after gate failure; startup will remain blocked while diagnostics continue.`
    );

    for (let poll = 1; poll <= maxPolls; poll += 1) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= this.extendedDeviceObservationMs) {
        break;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, this.extendedDeviceObservationPollMs);
      });

      const device = await this.bridge.getDeviceInfo().catch((error) => {
        this.store.log(`Extended observation getDeviceInfo failed on poll ${poll}/${maxPolls}: ${String(error)}`);
        return null;
      });

      if (device) {
        this.noteFirstNonNullDeviceInfo(`extended-observation-poll-${poll}`);
      }

      this.store.log(
        `Extended device observation poll ${poll}/${maxPolls}: launchSource=${this.latestLaunchSource ?? 'missing'}, statusCallbackSeen=${this.sawDeviceStatusCallback ? 'yes' : 'no'}, connectType=${this.latestDeviceStatusConnectType ?? 'unknown'}, getDeviceInfo=${device ? 'non-null' : 'null'}, elapsedSinceBridge=${this.formatElapsedFromBridge()}`
      );
    }
  }

  private noteFirstNonNullDeviceInfo(context: string) {
    if (this.firstNonNullDeviceInfoAt !== null) {
      return;
    }

    this.firstNonNullDeviceInfoAt = Date.now();
    this.store.log(
      `Device info became non-null first observed during ${context}; elapsedSinceBridge=${this.formatElapsedFromBridge(this.firstNonNullDeviceInfoAt)}`
    );
  }

  private formatElapsedFromBridge(at = Date.now()) {
    if (this.bridgeReadyAt === null) {
      return 'n/a';
    }

    return `${at - this.bridgeReadyAt}ms`;
  }

  private logSessionAttachSummary(stage: 'blocked' | 'startup-ready') {
    const launchSourceSeen = this.sawLaunchSourceCallback ? 'yes' : 'no';
    const launchSource = this.latestLaunchSource ?? 'missing';
    const deviceStatusSeen = this.sawDeviceStatusCallback ? 'yes' : 'no';
    const deviceInfoSeen = this.firstNonNullDeviceInfoAt !== null ? 'yes' : 'no';
    const launchElapsed = this.firstLaunchSourceCallbackAt !== null
      ? this.formatElapsedFromBridge(this.firstLaunchSourceCallbackAt)
      : 'n/a';
    const statusElapsed = this.firstDeviceStatusCallbackAt !== null
      ? this.formatElapsedFromBridge(this.firstDeviceStatusCallbackAt)
      : 'n/a';
    const deviceElapsed = this.firstNonNullDeviceInfoAt !== null
      ? this.formatElapsedFromBridge(this.firstNonNullDeviceInfoAt)
      : 'n/a';

    this.store.log(
      `Session attach diagnostic summary (${stage}): launchSourceSeen=${launchSourceSeen}, launchSource=${launchSource}, deviceStatusSeen=${deviceStatusSeen}, latestConnectType=${this.latestDeviceStatusConnectType ?? 'unknown'}, deviceInfoNonNull=${deviceInfoSeen}, t_launchSource=${launchElapsed}, t_deviceStatus=${statusElapsed}, t_deviceInfo=${deviceElapsed}, elapsedSinceBridge=${this.formatElapsedFromBridge()}`
    );
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
    const seedIndex = this.glasses.getActionSeedIndex();
    if (seedIndex !== null) {
      this.normalizer.seedListIndex(
        GLASSES_CONTAINERS.statusList.id,
        GLASSES_CONTAINERS.statusList.name,
        seedIndex
      );
    }

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
    this.lastAudioLifecycleSignature = this.getAudioLifecycleSignature(this.store.getState());
    this.unsubscribeStore = this.store.subscribe((nextState) => {
      this.captureCleanupReasonHint(nextState);
      this.syncOutboundAdvanceForState(nextState);
      const nextSignature = this.getAudioLifecycleSignature(nextState);
      if (nextSignature === this.lastAudioLifecycleSignature) {
        return;
      }

      this.lastAudioLifecycleSignature = nextSignature;
      void this.syncMicForCurrentState();
    });

    void this.syncMicForCurrentState();
    this.syncOutboundAdvanceForState(this.store.getState());
  }

  private async syncMicForCurrentState() {
    if (!this.bridge) {
      return;
    }

    const state = this.store.getState();
    const shouldBeOpen = state.started && state.screen === 'listening' && state.listeningMode === 'capture';
    if (shouldBeOpen) {
      this.audioCapture.startCaptureSession(state.captureSessionStartedAt ?? Date.now());
      if (!this.audioCapture.isMicOpen() && state.audioCaptureStatus !== 'opening') {
        this.pendingCleanupReason = null;
        this.store.setAudioCaptureStatus('opening', { micOpen: false, error: null });
        this.store.log('Mic open requested (entered listening).');
        const opened = await this.audioCapture.requestMicOpen(this.bridge);
        const afterOpenState = this.store.getState();
        const stillShouldBeOpen =
          afterOpenState.started &&
          afterOpenState.screen === 'listening' &&
          afterOpenState.listeningMode === 'capture';
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
    this.store.backToContacts();
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

      if (this.shouldSuppressSimulatorUnknownTap(item.input, item.inspection)) {
        this.store.log('Action suppressed: ignoring simulator UNKNOWN_EVENT status-list echo during sync settle.');
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
    if (state.screen !== 'listening' || state.listeningMode !== 'capture' || !state.started) {
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

    this.refreshCursorBlinkLoop();
    const rebuildSignature = this.glasses.getStructuralRebuildSignature();
    if (rebuildSignature !== this.lastRebuildSignature) {
      const rebuilt = await this.startupLifecycle.attemptRebuild('state-sync', this.glasses.buildRebuildContainer());
      if (rebuilt) {
        this.lastRebuildSignature = rebuildSignature;
      }
    }

    await this.syncText();
    await this.syncImages(forceImages);

    const seedIndex = this.glasses.getActionSeedIndex();
    if (seedIndex !== null) {
      this.normalizer.seedListIndex(
        GLASSES_CONTAINERS.statusList.id,
        GLASSES_CONTAINERS.statusList.name,
        seedIndex
      );
    }
    this.suppressSimulatorUnknownTapUntil = Date.now() + this.simulatorUnknownTapSuppressMs;
  }

  private async syncText(options?: { quiet?: boolean }) {
    if (!this.bridge || !this.store.getState().started) {
      return;
    }

    try {
      const state = this.store.getState();
      if (
        DEBUG_STT_COUNTDOWN &&
        state.screen === 'listening' &&
        state.listeningMode === 'capture' &&
        state.captureSessionStartedAt !== null
      ) {
        const remainingMs = Math.max(0, this.maxCaptureDurationMs - state.elapsedCaptureDurationMs);
        if (remainingMs <= 1000) {
          console.debug('[stt-countdown:sync]', {
            listeningSessionId: state.listeningSessionId,
            captureSessionStartedAt: state.captureSessionStartedAt,
            elapsedCaptureDurationMs: state.elapsedCaptureDurationMs,
            remainingMs,
          });
        }
      }

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
      if (!options?.quiet) {
        this.store.log(ok ? 'Text synced to Even.' : 'Text sync failed.');
      }
    } catch (error) {
      if (!options?.quiet) {
        this.store.log(`Text sync error: ${String(error)}`);
      }
    }
  }

  private async syncImages(force = false) {
    if (!this.imageQueue || !this.store.getState().started) {
      return;
    }

    const portraitAsset = this.glasses.getPortraitAssetKey();
    if (!portraitAsset) {
      this.lastQueuedPortraitAsset = null;
      this.lastRenderedPortraitAsset = null;
      return;
    }

    const changed = force || this.lastRenderedPortraitAsset !== portraitAsset;
    if (!changed) {
      return;
    }

    if (!force && this.lastQueuedPortraitAsset === portraitAsset) {
      return;
    }

    const now = Date.now();
    const remainingCooldownMs = this.lastPortraitSyncAt === null
      ? 0
      : this.portraitSyncCooldownMs - (now - this.lastPortraitSyncAt);
    if (!force && remainingCooldownMs > 0) {
      this.schedulePortraitCooldownSync(remainingCooldownMs);
      return;
    }

    try {
      const portraitBytes = await getCodecAssetBytes(portraitAsset);
      this.lastQueuedPortraitAsset = portraitAsset;
      await this.imageQueue.enqueue({
        containerID: GLASSES_CONTAINERS.portraitImage.id,
        containerName: GLASSES_CONTAINERS.portraitImage.name,
        imageData: portraitBytes,
      });

      this.lastRenderedPortraitAsset = portraitAsset;
      this.lastPortraitSyncAt = Date.now();
      this.store.setImageSyncDebug({
        lastPortraitAsset: portraitAsset,
        lastResult: 'success',
        lastAt: Date.now(),
      });
    } catch {
      this.lastQueuedPortraitAsset = null;
      this.store.setImageSyncDebug({
        lastPortraitAsset: portraitAsset,
        lastResult: 'failed',
        lastAt: Date.now(),
      });
    }
  }

  private schedulePortraitCooldownSync(delayMs: number) {
    if (this.portraitCooldownTimer !== null) {
      return;
    }

    this.portraitCooldownTimer = window.setTimeout(() => {
      this.portraitCooldownTimer = null;
      this.scheduleSync(false);
    }, delayMs + 10);
  }

  private refreshCursorBlinkLoop() {
    const shouldAnimate = this.store.getState().started && this.glasses.shouldAnimateCursor();
    if (!shouldAnimate) {
      if (this.cursorBlinkTimer !== null) {
        window.clearInterval(this.cursorBlinkTimer);
        this.cursorBlinkTimer = null;
      }
      return;
    }

    if (this.cursorBlinkTimer !== null) {
      return;
    }

    this.cursorBlinkTimer = window.setInterval(() => {
      if (!this.store.getState().started || !this.glasses.shouldAnimateCursor()) {
        if (this.cursorBlinkTimer !== null) {
          window.clearInterval(this.cursorBlinkTimer);
          this.cursorBlinkTimer = null;
        }
        return;
      }

      void this.syncText({ quiet: true });
    }, this.glasses.getCursorBlinkIntervalMs());
  }

  private getSyncSignature() {
    const state = this.store.getState();
    const draftGraceActive =
      state.sttDraftDisplayText.trim().length > 0 &&
      state.sttDraftVisibleUntil !== null &&
      Date.now() <= state.sttDraftVisibleUntil;
    return JSON.stringify({
      screen: state.screen,
      screenBeforeDebug: state.screenBeforeDebug,
      selectedContactIndex: state.selectedContactIndex,
      listeningActionIndex: state.listeningActionIndex,
      listeningMode: state.listeningMode,
      listeningReviewOffset: state.listeningMode === 'review' ? state.listeningReviewOffset : null,
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
      speechWindowOpen: state.speechWindow.isOpen,
      speechWindowSource: state.speechWindow.source,
      speechWindowEntryId: state.speechWindow.entryId,
      speechWindowRole: state.speechWindow.role,
      micOpen: state.micOpen,
      audioCaptureStatus: state.audioCaptureStatus,
      sttStatus: state.sttStatus,
      sttPartialBucket: state.sttPartialTranscript ? state.sttPartialTranscript.slice(0, 64) : null,
      sttDraftVisible: draftGraceActive,
      sttDraftBucket: draftGraceActive ? state.sttDraftDisplayText.slice(0, 64) : null,
      sttError: state.sttError,
      elapsedCaptureDurationBucket: Math.floor(state.elapsedCaptureDurationMs / 100),
      activityBucket: Math.floor(state.listeningActivityLevel * 10),
      frameAtBucket: state.lastAudioFrameAt ? Math.floor(state.lastAudioFrameAt / 1000) : null,
      lastNormalizedInput: state.lastNormalizedInput,
      lastRawEventType: state.lastRawEvent?.rawEventTypeName ?? null,
    });
  }

  private refreshDraftVisibilityTimer() {
    const state = this.store.getState();
    if (
      !state.sttDraftDisplayText.trim() ||
      state.sttDraftVisibleUntil === null
    ) {
      if (this.draftVisibilityTimer !== null) {
        window.clearTimeout(this.draftVisibilityTimer);
        this.draftVisibilityTimer = null;
      }
      return;
    }

    const remainingMs = state.sttDraftVisibleUntil - Date.now();
    if (remainingMs <= 0) {
      if (this.draftVisibilityTimer !== null) {
        window.clearTimeout(this.draftVisibilityTimer);
        this.draftVisibilityTimer = null;
      }
      return;
    }

    if (this.draftVisibilityTimer !== null) {
      window.clearTimeout(this.draftVisibilityTimer);
    }

    this.draftVisibilityTimer = window.setTimeout(() => {
      this.draftVisibilityTimer = null;
      this.queueSyncFromState();
    }, remainingMs + 10);
  }

  private clearOutboundAdvanceTimer() {
    if (this.outboundAdvanceTimer === null) {
      return;
    }

    window.clearTimeout(this.outboundAdvanceTimer);
    this.outboundAdvanceTimer = null;
  }

  private syncOutboundAdvanceForState(state: ReturnType<AppStore['getState']>) {
    if (!state.started || state.screen !== 'incoming') {
      this.clearOutboundAdvanceTimer();
      return;
    }

    if (this.outboundAdvanceTimer !== null) {
      return;
    }

    this.outboundAdvanceTimer = window.setTimeout(() => {
      this.outboundAdvanceTimer = null;
      const nextState = this.store.getState();
      if (!nextState.started || nextState.screen !== 'incoming') {
        return;
      }

      this.store.presentOutboundGreeting();
    }, this.outboundAdvanceDelayMs);
  }

  private async ensureSttForCurrentState() {
    const state = this.store.getState();
    if (!state.started || state.screen !== 'listening' || state.listeningMode !== 'capture') {
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

    if (this.sttStartInFlightListeningSessionId === state.listeningSessionId) {
      return;
    }

    await this.startSttSessionForListening(state.listeningSessionId, false);
  }

  private async startSttSessionForListening(listeningSessionId: number, isRetry: boolean) {
    this.clearSttRetryTimer('start-session');

    const state = this.store.getState();
    if (
      !state.started ||
      state.screen !== 'listening' ||
      state.listeningMode !== 'capture' ||
      state.listeningSessionId !== listeningSessionId
    ) {
      return;
    }

    if (!state.micOpen || state.audioCaptureStatus !== 'listening' || !this.audioCapture.isMicOpen()) {
      return;
    }

    if (this.sttSession) {
      return;
    }

    if (this.sttStartInFlightListeningSessionId === listeningSessionId) {
      return;
    }

    const sttStartAttemptToken = this.nextSttStartAttemptToken++;
    this.sttStartInFlightListeningSessionId = listeningSessionId;
    this.sttStartInFlightAttemptToken = sttStartAttemptToken;

    this.logSttEvent('stt_auth_requested', { listeningSessionId, retry: isRetry });

    let accessToken = '';
    try {
      const auth = await requestSttBrokerAuth();
      accessToken = auth.accessToken;
      this.logSttEvent('stt_auth_succeeded', { listeningSessionId, retry: isRetry });
    } catch (error) {
      this.clearSttStartInFlight(sttStartAttemptToken);
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

    if (!this.isCurrentSttStartAttempt(listeningSessionId, sttStartAttemptToken)) {
      return;
    }

    const latestState = this.store.getState();
    if (
      !latestState.started ||
      latestState.screen !== 'listening' ||
      latestState.listeningMode !== 'capture' ||
      latestState.listeningSessionId !== listeningSessionId ||
      !latestState.micOpen ||
      latestState.audioCaptureStatus !== 'listening' ||
      !this.audioCapture.isMicOpen()
    ) {
      this.clearSttStartInFlight(sttStartAttemptToken);
      return;
    }

    if (this.sttSession) {
      this.clearSttStartInFlight(sttStartAttemptToken);
      return;
    }

    const session = new DeepgramStreamingSttSession({ accessToken });
    const sttSessionToken = this.nextSttSessionToken++;
    this.sttSession = session;
    this.activeSttListeningSessionId = listeningSessionId;
    this.activeSttSessionToken = sttSessionToken;
    this.clearSttStartInFlight(sttStartAttemptToken);
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

      this.logSttEvent('stt_runtime_error', {
        listeningSessionId,
        retry: isRetry,
        detail: error,
      });
      void this.handleSttErrorForSession(listeningSessionId, sttSessionToken, session, error);
    });

    try {
      this.logSttEvent('stt_start_connecting', { listeningSessionId, retry: isRetry });
      await session.start();
      this.logSttEvent('stt_start_succeeded', { listeningSessionId, retry: isRetry });
      if (!this.canApplySttCallback(listeningSessionId, sttSessionToken, session, 'post-start-reconcile')) {
        if (this.sttSession === session) {
          await this.stopSttIfNeeded('post-start-reconcile');
        } else {
          await this.safeStopSttSession(session).catch(() => undefined);
        }
      }
    } catch (error) {
      this.clearSttStartInFlight(sttStartAttemptToken);
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
        detail: appError.detail,
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

  private isCurrentSttStartAttempt(listeningSessionId: number, attemptToken: number) {
    return (
      this.sttStartInFlightListeningSessionId === listeningSessionId &&
      this.sttStartInFlightAttemptToken === attemptToken
    );
  }

  private clearSttStartInFlight(attemptToken?: number) {
    if (
      typeof attemptToken === 'number' &&
      this.sttStartInFlightAttemptToken !== attemptToken
    ) {
      return;
    }

    this.sttStartInFlightListeningSessionId = null;
    this.sttStartInFlightAttemptToken = null;
  }

  private async stopSttIfNeeded(reason: string) {
    if (this.sttStopInFlight) {
      await this.sttStopInFlight;
      return;
    }

    const stopPromise = this.stopSttSessionInternal(reason);
    this.sttStopInFlight = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (this.sttStopInFlight === stopPromise) {
        this.sttStopInFlight = null;
      }
    }
  }

  private async stopSttSessionInternal(reason: string) {
    this.clearSttRetryTimer(reason);
    this.clearSttStartInFlight();
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
      await this.safeStopSttSession(session);
      this.store.setSttStatus('idle', { error: null });
      this.store.log(`STT close success (${reason}).`);
    } catch (error) {
      this.store.setSttStatus('error', { error: `STT close failed: ${String(error)}` });
      this.store.log(`STT close failed (${reason}): ${String(error)}`);
    }
  }

  private async safeStopSttSession(session: StreamingSttSession | null | undefined) {
    if (!session || typeof session.stop !== 'function') {
      return;
    }

    await session.stop();
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
      state.listeningMode === 'capture' &&
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

    if (previous.screen === 'incoming' && nextState.screen === 'contacts') {
      this.pendingCleanupReason = 'back';
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

  private shouldSuppressSimulatorUnknownTap(
    input: NormalizedInput,
    inspection: RawEventDebugInfo
  ) {
    if (input !== 'TAP' || Date.now() >= this.suppressSimulatorUnknownTapUntil) {
      return false;
    }

    if (
      inspection.source !== 'listEvent' ||
      inspection.containerID !== GLASSES_CONTAINERS.statusList.id ||
      inspection.containerName !== GLASSES_CONTAINERS.statusList.name
    ) {
      return false;
    }

    if (inspection.currentSelectItemIndex === null && inspection.currentSelectItemName === null) {
      return false;
    }

    const tokens = inspection.eventTypeCandidates.length > 0
      ? inspection.eventTypeCandidates
      : [inspection.normalizedTypeToken];

    return tokens.every((token) => token === 'UNKNOWN_EVENT');
  }

  private getAudioLifecycleSignature(state: ReturnType<AppStore['getState']>) {
    return JSON.stringify({
      started: state.started,
      screen: state.screen,
      listeningMode: state.listeningMode,
      selectedContactIndex: state.selectedContactIndex,
      listeningSessionId: state.listeningSessionId,
      micOpen: state.micOpen,
      audioCaptureStatus: state.audioCaptureStatus,
      sttStatus: state.sttStatus,
    });
  }
}

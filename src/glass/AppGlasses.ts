import { CONTACTS } from '../app/contacts';
import type { AppStore } from '../app/state';
import type { NormalizedInput, RawEventDebugInfo } from '../app/types';
import type { BridgePagePayload } from '../bridge/startupLifecycle';
import type { CodecImageRenderRequest } from '../codecGlassesAssets';
import { CreateStartUpPageContainer, TextContainerProperty } from '@evenrealities/even_hub_sdk';
import { selectActionItemsForGlasses, selectGlassPortraitState, selectGlassScreenView } from './selectors';
import {
  GLASSES_CONTAINERS,
  type GlassArrowPulseDirection,
  type GlassPortraitState,
  type GlassScreenView,
} from './shared';

export type InputHandleResult = {
  changed: boolean;
  requestClose: boolean;
};

export class AppGlasses {
  private readonly store: AppStore;
  private readonly cursorBlinkIntervalMs = 520;
  private readonly arrowPulseDurationMs = 210;
  private readonly scriptedSignalTickMs = 170;
  private arrowPulseDirection: GlassArrowPulseDirection = 'none';
  private arrowPulseExpiresAt = 0;

  constructor(store: AppStore) {
    this.store = store;
  }

  private getView() {
    const view = selectGlassScreenView(this.store.getState());
    return {
      ...view,
      arrowPulseDirection: this.getActiveArrowPulseDirection(),
    } as GlassScreenView;
  }

  getPortraitState(): GlassPortraitState {
    return selectGlassPortraitState(this.store.getState());
  }

  getImageRenderRequests() {
    const view = this.getView();
    const requests: Array<{
      containerID: number;
      containerName: string;
      syncKey: string;
      request: CodecImageRenderRequest;
    }> = [];

    if (!view.showPortrait) {
      return requests;
    }

    const portraitState = this.getPortraitState();
    const now = Date.now();
    const barBucket = this.resolveCenterSignalBarBucket(portraitState, now);

    requests.push(
      {
        containerID: GLASSES_CONTAINERS.portraitImage.id,
        containerName: GLASSES_CONTAINERS.portraitImage.name,
        syncKey: `left:${portraitState.leftPortraitAsset}:${portraitState.leftActive ? 'active' : 'idle'}`,
        request: {
          kind: 'portrait-panel',
          side: 'left',
          portraitAsset: portraitState.leftPortraitAsset,
          active: portraitState.leftActive,
        },
      },
      {
        containerID: GLASSES_CONTAINERS.centerImage.id,
        containerName: GLASSES_CONTAINERS.centerImage.name,
        syncKey: JSON.stringify({
          variant: view.centerModuleVariant,
          barBucket,
          arrowPulseDirection: view.arrowPulseDirection,
        }),
        request: {
          kind: 'center-module',
          variant: view.centerModuleVariant,
          barBucket,
          arrowPulseDirection: view.arrowPulseDirection,
        },
      },
      {
        containerID: GLASSES_CONTAINERS.rightPortraitImage.id,
        containerName: GLASSES_CONTAINERS.rightPortraitImage.name,
        syncKey: `right:${portraitState.rightPortraitAsset}:${portraitState.rightActive ? 'active' : 'idle'}`,
        request: {
          kind: 'portrait-panel',
          side: 'right',
          portraitAsset: portraitState.rightPortraitAsset,
          active: portraitState.rightActive,
        },
      },
    );

    return requests;
  }

  getActionSeedIndex() {
    const view = this.getView();
    return view.showActions ? view.selectedActionIndex : null;
  }

  getTextRenderRequests() {
    const view = this.getView();

    return [
      {
        containerID: GLASSES_CONTAINERS.topRowText.id,
        containerName: GLASSES_CONTAINERS.topRowText.name,
        content: view.topRowText || ' ',
      },
      {
        containerID: GLASSES_CONTAINERS.centerTopLabelText.id,
        containerName: GLASSES_CONTAINERS.centerTopLabelText.name,
        content: view.centerTopLabelText || ' ',
      },
      {
        containerID: GLASSES_CONTAINERS.centerReadoutText.id,
        containerName: GLASSES_CONTAINERS.centerReadoutText.name,
        content: view.centerReadoutText || ' ',
      },
      {
        containerID: GLASSES_CONTAINERS.centerBottomLabelText.id,
        containerName: GLASSES_CONTAINERS.centerBottomLabelText.name,
        content: view.centerBottomLabelText || ' ',
      },
      {
        containerID: GLASSES_CONTAINERS.dialogueText.id,
        containerName: GLASSES_CONTAINERS.dialogueText.name,
        content: view.subtitleText || ' ',
      },
      {
        containerID: GLASSES_CONTAINERS.horizontalActionsText.id,
        containerName: GLASSES_CONTAINERS.horizontalActionsText.name,
        content: view.horizontalActionsText || ' ',
      },
    ];
  }

  getStructuralRebuildSignature() {
    const rebuild = this.buildRebuildContainer();
    return JSON.stringify({
      containerTotalNum: rebuild.containerTotalNum,
      imageObject: rebuild.imageObject ?? [],
      textObject: (rebuild.textObject ?? []).map(({ content: _content, ...container }) => container),
      listObject: rebuild.listObject ?? [],
    });
  }

  getActionItems() {
    const view = this.getView();
    return view.showActions ? selectActionItemsForGlasses(this.store.getState()) : [];
  }

  shouldAnimateCursor() {
    return this.getView().liveLineKind !== 'none';
  }

  getCursorBlinkIntervalMs() {
    return this.cursorBlinkIntervalMs;
  }

  getAnimationTickDelayMs() {
    const now = Date.now();
    const pulseRemainingMs = this.arrowPulseExpiresAt - now;
    if (this.getActiveArrowPulseDirection(now) !== 'none' && pulseRemainingMs > 0) {
      return Math.min(95, pulseRemainingMs);
    }

    const view = this.getView();
    if (!view.showPortrait) {
      return null;
    }

    const portraitState = this.getPortraitState();
    if (this.isScriptedSignalAnimating(portraitState, now)) {
      return this.scriptedSignalTickMs;
    }

    return null;
  }

  handleNormalizedInput(input: NormalizedInput, inspection: RawEventDebugInfo): InputHandleResult {
    const previousState = this.store.getState();
    this.store.setLastInput(input, inspection);
    if (input === 'UP') {
      this.armArrowPulse('left');
    } else if (input === 'DOWN') {
      this.armArrowPulse('right');
    }
    const resolvedSelectionIndex = this.resolveListSelectionIndex(inspection);
    if (
      resolvedSelectionIndex !== null &&
      this.shouldApplyListSelectionFromInspection(input, previousState.screen, inspection)
    ) {
      this.applyListSelectionFromIndex(resolvedSelectionIndex);
    }
    const state = this.store.getState();

    if (input === 'AT_TOP' || input === 'AT_BOTTOM') {
      return { changed: false, requestClose: false };
    }

    if (state.screen === 'debug') {
      if (input === 'TAP' || input === 'DOUBLE_TAP') {
        this.store.exitDebugScreen();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'contacts') {
      if (
        (input === 'UP' || input === 'DOWN') &&
        this.isContactsSelectionInspection(inspection, resolvedSelectionIndex)
      ) {
        return {
          changed: state.selectedContactIndex !== previousState.selectedContactIndex,
          requestClose: false,
        };
      }

      if (input === 'UP') {
        this.store.moveContactSelection(-1, { trustVisibleHighlight: true });
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.moveContactSelection(1, { trustVisibleHighlight: true });
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        const tapResolution = this.resolveContactsTapSelectionIndex(resolvedSelectionIndex, inspection);
        if (tapResolution.index === null) {
          this.store.log(
            `Contacts tap blocked: ${tapResolution.explicitFailureReason}; ${tapResolution.highlightFailureReason}.`
          );
          return { changed: false, requestClose: false };
        }

        this.store.setSelectedContactIndex(tapResolution.index, { trustVisibleHighlight: true });
        this.store.goToIncomingForSelectedContact();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: input === 'DOUBLE_TAP' };
    }

    if (state.screen === 'incoming') {
      if (input === 'DOUBLE_TAP') {
        this.store.backToContacts();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'listening') {
      if (state.listeningFailureKind === 'speech_unavailable') {
        const actionCount = this.getActionItems().length;
        if (input === 'UP') {
          this.store.setListeningActionIndex(Math.max(0, state.listeningActionIndex - 1));
          return { changed: true, requestClose: false };
        }

        if (input === 'DOWN') {
          this.store.setListeningActionIndex(Math.min(Math.max(0, actionCount - 1), state.listeningActionIndex + 1));
          return { changed: true, requestClose: false };
        }

        if (input === 'DOUBLE_TAP') {
          this.store.backToContacts();
          return { changed: true, requestClose: false };
        }

        if (input === 'TAP') {
          const selectedActionIndex =
            resolvedSelectionIndex !== null
            && resolvedSelectionIndex >= 0
            && resolvedSelectionIndex < actionCount
              ? resolvedSelectionIndex
              : state.listeningActionIndex;
          const selectedAction = this.getActionItems()[selectedActionIndex] ?? '';

          if (selectedAction === 'Retry') {
            this.store.retryListeningTurn();
            return { changed: true, requestClose: false };
          }

          if (selectedAction === 'Back') {
            this.store.backToContacts();
            return { changed: true, requestClose: false };
          }

          return { changed: false, requestClose: false };
        }

        return { changed: false, requestClose: false };
      }

      if (
        state.listeningMode === 'capture'
        && state.listeningCaptureState === 'capturing'
        && state.listeningSessionReachedActiveCapture
        && state.listeningFailureKind === null
      ) {
        if (input === 'TAP') {
          this.store.pauseListeningCapture();
          return { changed: true, requestClose: false };
        }

        if (input === 'DOUBLE_TAP') {
          this.store.endListening();
          return { changed: true, requestClose: false };
        }

        return { changed: false, requestClose: false };
      }

      const actionCount = this.getActionItems().length;
      if (input === 'UP') {
        this.store.setListeningActionIndex(Math.max(0, state.listeningActionIndex - 1));
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.setListeningActionIndex(Math.min(Math.max(0, actionCount - 1), state.listeningActionIndex + 1));
        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        this.store.endListening();
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        const selectedActionIndex =
          resolvedSelectionIndex !== null
          && resolvedSelectionIndex >= 0
          && resolvedSelectionIndex < actionCount
            ? resolvedSelectionIndex
            : state.listeningActionIndex;
        const selectedAction = this.getActionItems()[selectedActionIndex] ?? '';

        if (selectedAction === 'RESUME') {
          this.store.resumeListeningCapture();
          return { changed: true, requestClose: false };
        }

        if (selectedAction === 'TRANSMIT') {
          this.store.transmitCurrentUserTurn();
          return { changed: true, requestClose: false };
        }

        if (selectedAction === 'Retry') {
          this.store.retryListeningTurn();
          return { changed: true, requestClose: false };
        }

        return { changed: false, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'active') {
      if (input === 'UP' || input === 'DOWN') {
        this.store.setActiveActionIndex(0);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        this.store.endCall();
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        this.store.advanceDialogueOrEnd();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'ended') {
      if (input === 'TAP') {
        this.store.backToContacts();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: input === 'DOUBLE_TAP' };
    }

    return { changed: false, requestClose: false };
  }

  private resolveListSelectionIndex(inspection: RawEventDebugInfo) {
    if (inspection.source !== 'listEvent') {
      return null;
    }

    let resolvedIndex: number | null = null;

    if (inspection.currentSelectItemIndex !== null) {
      resolvedIndex = inspection.currentSelectItemIndex;
    } else if (inspection.currentSelectItemName !== null) {
      const visibleItems = this.getActionItems();
      const normalizeListLabel = (value: string) => value.trim();
      const matchingIndex = visibleItems.findIndex((item) => item === inspection.currentSelectItemName);
      if (matchingIndex >= 0) {
        resolvedIndex = matchingIndex;
      } else {
        const normalizedName = normalizeListLabel(inspection.currentSelectItemName);
        const normalizedMatchIndex = visibleItems.findIndex((item) => normalizeListLabel(item) === normalizedName);
        if (normalizedMatchIndex >= 0) {
          resolvedIndex = normalizedMatchIndex;
        }
      }
    }

    if (
      resolvedIndex !== null &&
      this.store.getState().screen === 'contacts' &&
      !this.isContactsSelectionInspection(inspection, resolvedIndex)
    ) {
      return null;
    }

    return resolvedIndex;
  }

  private shouldApplyListSelectionFromInspection(
    input: NormalizedInput,
    screen: ReturnType<AppStore['getState']>['screen'],
    inspection: RawEventDebugInfo,
  ) {
    if (screen === 'contacts' && input === 'TAP') {
      return false;
    }

    return inspection.source === 'listEvent';
  }

  private resolveContactsTapSelectionIndex(resolvedSelectionIndex: number | null, inspection: RawEventDebugInfo) {
    const explicitTapRowIndex = this.resolveExplicitTrustedContactsTapIndex(inspection);
    if (explicitTapRowIndex !== null) {
      return {
        index: explicitTapRowIndex,
        source: 'explicit_tap_row' as const,
        explicitFailureReason: 'explicit tap row resolved',
        highlightFailureReason: 'trusted visible highlight not needed',
      };
    }

    const trustedVisibleHighlightIndex = this.resolveTrustedVisibleContactsHighlightIndex(resolvedSelectionIndex, inspection);
    if (trustedVisibleHighlightIndex !== null) {
      return {
        index: trustedVisibleHighlightIndex,
        source: 'trusted_visible_highlight' as const,
        explicitFailureReason: this.describeExplicitTapRowFailure(inspection),
        highlightFailureReason: 'trusted visible highlight resolved',
      };
    }

    const state = this.store.getState();
    if (state.screen === 'contacts' && this.isValidContactsIndex(state.selectedContactIndex)) {
      return {
        index: state.selectedContactIndex,
        source: 'current_selected_contact' as const,
        explicitFailureReason: this.describeExplicitTapRowFailure(inspection),
        highlightFailureReason: this.describeTrustedVisibleHighlightFailure(resolvedSelectionIndex, inspection),
      };
    }

    return {
      index: null,
      source: null,
      explicitFailureReason: this.describeExplicitTapRowFailure(inspection),
      highlightFailureReason: this.describeTrustedVisibleHighlightFailure(resolvedSelectionIndex, inspection),
    };
  }

  private resolveExplicitTrustedContactsTapIndex(inspection: RawEventDebugInfo) {
    if (inspection.source !== 'listEvent' || !this.isStatusListInspection(inspection)) {
      return null;
    }

    if (inspection.currentSelectItemIndex !== null) {
      return this.isValidContactsIndex(inspection.currentSelectItemIndex)
        ? inspection.currentSelectItemIndex
        : null;
    }

    if (inspection.currentSelectItemName !== null) {
      const selectedItemName = inspection.currentSelectItemName.trim();
      const matchingIndex = CONTACTS.findIndex((contact) => contact.name === selectedItemName);
      return matchingIndex >= 0 ? matchingIndex : null;
    }

    return null;
  }

  private resolveTrustedVisibleContactsHighlightIndex(
    resolvedSelectionIndex: number | null,
    inspection: RawEventDebugInfo,
  ) {
    if (
      resolvedSelectionIndex !== null
      && this.isContactsSelectionInspection(inspection, resolvedSelectionIndex)
    ) {
      return resolvedSelectionIndex;
    }

    const state = this.store.getState();
    if (state.screen !== 'contacts') {
      return null;
    }

    if (state.trustedContactsHighlightIndex === null || state.trustedContactsHighlightEstablishedAt === null) {
      return null;
    }

    return this.isValidContactsIndex(state.trustedContactsHighlightIndex)
      ? state.trustedContactsHighlightIndex
      : null;
  }

  private describeExplicitTapRowFailure(inspection: RawEventDebugInfo) {
    if (inspection.source !== 'listEvent' || !this.isStatusListInspection(inspection)) {
      return 'explicit tap row unavailable';
    }

    if (inspection.currentSelectItemIndex !== null || inspection.currentSelectItemName !== null) {
      return 'explicit tap row invalid';
    }

    return 'explicit tap row unavailable';
  }

  private describeTrustedVisibleHighlightFailure(
    resolvedSelectionIndex: number | null,
    inspection: RawEventDebugInfo,
  ) {
    if (
      resolvedSelectionIndex !== null
      && this.isContactsSelectionInspection(inspection, resolvedSelectionIndex)
    ) {
      return 'trusted visible highlight unavailable';
    }

    const state = this.store.getState();
    if (state.screen !== 'contacts') {
      return 'trusted visible highlight missing or invalidated';
    }

    if (state.trustedContactsHighlightIndex === null || state.trustedContactsHighlightEstablishedAt === null) {
      return 'no trusted visible highlight';
    }

    if (!this.isValidContactsIndex(state.trustedContactsHighlightIndex)) {
      return 'trusted visible highlight invalid';
    }

    return 'trusted visible highlight missing or invalidated';
  }

  buildMinimalStartContainer(): BridgePagePayload {
    const header = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 28,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 4,
      containerID: GLASSES_CONTAINERS.startupHeaderText.id,
      containerName: GLASSES_CONTAINERS.startupHeaderText.name,
      content: 'WHAT EVEN',
      isEventCapture: 0,
    });

    const body = new TextContainerProperty({
      xPosition: 0,
      yPosition: 28,
      width: 576,
      height: 260,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 4,
      containerID: GLASSES_CONTAINERS.startupBodyText.id,
      containerName: GLASSES_CONTAINERS.startupBodyText.name,
      content: 'Bridge connected.\nLoading on-device UI...',
      isEventCapture: 1,
    });

    return new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [header, body],
    });
  }

  buildTextOnlyRebuildContainer(): BridgePagePayload {
    const view = this.getView();
    const textObject = this.buildTextContainers();
    const listObject = view.captureSurfaceMode === 'list' ? [this.buildStatusListContainer()] : [];

    return {
      containerTotalNum: textObject.length + listObject.length,
      textObject: textObject.length > 0 ? textObject : undefined,
      listObject: listObject.length > 0 ? listObject : undefined,
    };
  }

  buildRebuildContainer(): BridgePagePayload {
    const textObject = this.buildTextContainers();
    const imageObject = this.buildImageContainers();
    const listObject = this.getView().captureSurfaceMode === 'list' ? [this.buildStatusListContainer()] : [];

    return {
      containerTotalNum: textObject.length + imageObject.length + listObject.length,
      imageObject: imageObject.length > 0 ? imageObject : undefined,
      textObject: textObject.length > 0 ? textObject : undefined,
      listObject: listObject.length > 0 ? listObject : undefined,
    };
  }

  private applyListSelectionFromIndex(index: number) {
    const state = this.store.getState();
    const view = this.getView();
    if (!view.showActions) {
      return;
    }

    if (state.screen === 'contacts') {
      if (!this.isValidContactsIndex(index)) {
        return;
      }

      this.store.setSelectedContactIndex(index, { trustVisibleHighlight: true });
      return;
    }

    if (state.screen === 'active') {
      this.store.setActiveActionIndex(index);
      return;
    }

    if (
      state.screen === 'listening' &&
      (state.listeningMode === 'actions' || (state.listeningMode === 'capture' && state.listeningCaptureState === 'paused'))
    ) {
      this.store.setListeningActionIndex(index);
      return;
    }

    if (state.screen === 'ended') {
      this.store.setEndedActionIndex(index);
    }
  }

  private buildTextContainers() {
    return [
      this.buildTopRowTextContainer(),
      this.buildCenterTopLabelTextContainer(),
      this.buildCenterReadoutTextContainer(),
      this.buildCenterBottomLabelTextContainer(),
      this.buildSubtitleTextContainer(),
      this.buildHorizontalActionsTextContainer(),
    ];
  }

  private buildImageContainers() {
    if (!this.getView().showPortrait) {
      return [];
    }

    return [
      this.buildLeftPortraitImageContainer(),
      this.buildCenterImageContainer(),
      this.buildRightPortraitImageContainer(),
    ];
  }

  private buildStatusListContainer() {
    const actions = this.getActionItems();
    const safeActions = actions.length > 0
      ? Array.from({ length: actions.length }, () => '')
      : [''];
    return {
      xPosition: 556,
      yPosition: 78,
      width: 20,
      height: 128,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
      containerID: GLASSES_CONTAINERS.statusList.id,
      containerName: GLASSES_CONTAINERS.statusList.name,
      itemContainer: {
        itemCount: safeActions.length,
        itemName: safeActions,
        itemWidth: 0,
        isItemSelectBorderEn: 0,
      },
      isEventCapture: 1,
    };
  }

  private buildTopRowTextContainer() {
    const view = this.getView();
    return {
      xPosition: 20,
      yPosition: 0,
      width: 536,
      height: 22,
      containerID: GLASSES_CONTAINERS.topRowText.id,
      containerName: GLASSES_CONTAINERS.topRowText.name,
      content: view.topRowText || ' ',
      isEventCapture: 0,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
    };
  }

  private buildCenterReadoutTextContainer() {
    const view = this.getView();
    return {
      xPosition: 220,
      yPosition: 72,
      width: 148,
      height: 30,
      containerID: GLASSES_CONTAINERS.centerReadoutText.id,
      containerName: GLASSES_CONTAINERS.centerReadoutText.name,
      content: view.centerReadoutText || ' ',
      isEventCapture: 0,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
    };
  }

  private buildCenterTopLabelTextContainer() {
    const view = this.getView();
    return {
      xPosition: 246,
      yPosition: 4,
      width: 92,
      height: 20,
      containerID: GLASSES_CONTAINERS.centerTopLabelText.id,
      containerName: GLASSES_CONTAINERS.centerTopLabelText.name,
      content: view.centerTopLabelText || ' ',
      isEventCapture: 0,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
    };
  }

  private buildCenterBottomLabelTextContainer() {
    const view = this.getView();
    return {
      xPosition: 232,
      yPosition: 118,
      width: 112,
      height: 22,
      containerID: GLASSES_CONTAINERS.centerBottomLabelText.id,
      containerName: GLASSES_CONTAINERS.centerBottomLabelText.name,
      content: view.centerBottomLabelText || ' ',
      isEventCapture: 0,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
    };
  }

  private buildSubtitleTextContainer() {
    const view = this.getView();
    return {
      xPosition: 36,
      yPosition: 170,
      width: 504,
      height: 74,
      containerID: GLASSES_CONTAINERS.dialogueText.id,
      containerName: GLASSES_CONTAINERS.dialogueText.name,
      content: view.subtitleText || ' ',
      isEventCapture: view.captureSurfaceMode === 'text' ? 1 : 0,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
    };
  }

  private buildHorizontalActionsTextContainer() {
    const view = this.getView();
    return {
      xPosition: 28,
      yPosition: 250,
      width: 520,
      height: 30,
      containerID: GLASSES_CONTAINERS.horizontalActionsText.id,
      containerName: GLASSES_CONTAINERS.horizontalActionsText.name,
      content: view.horizontalActionsText || ' ',
      isEventCapture: 0,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
    };
  }

  private buildLeftPortraitImageContainer() {
    return {
      xPosition: 18,
      yPosition: 12,
      width: 120,
      height: 132,
      containerID: GLASSES_CONTAINERS.portraitImage.id,
      containerName: GLASSES_CONTAINERS.portraitImage.name,
    };
  }

  private buildCenterImageContainer() {
    return {
      xPosition: 146,
      yPosition: 8,
      width: 284,
      height: 144,
      containerID: GLASSES_CONTAINERS.centerImage.id,
      containerName: GLASSES_CONTAINERS.centerImage.name,
    };
  }

  private buildRightPortraitImageContainer() {
    return {
      xPosition: 438,
      yPosition: 12,
      width: 120,
      height: 132,
      containerID: GLASSES_CONTAINERS.rightPortraitImage.id,
      containerName: GLASSES_CONTAINERS.rightPortraitImage.name,
    };
  }

  private isStatusListInspection(inspection: RawEventDebugInfo) {
    return (
      inspection.containerID === GLASSES_CONTAINERS.statusList.id &&
      inspection.containerName === GLASSES_CONTAINERS.statusList.name
    );
  }

  private isValidContactsIndex(index: number) {
    return index >= 0 && index < CONTACTS.length;
  }

  private isContactsSelectionInspection(inspection: RawEventDebugInfo, resolvedIndex: number | null) {
    return (
      this.store.getState().screen === 'contacts' &&
      inspection.source === 'listEvent' &&
      this.isStatusListInspection(inspection) &&
      resolvedIndex !== null &&
      this.isValidContactsIndex(resolvedIndex)
    );
  }

  private armArrowPulse(direction: Exclude<GlassArrowPulseDirection, 'none'>) {
    this.arrowPulseDirection = direction;
    this.arrowPulseExpiresAt = Date.now() + this.arrowPulseDurationMs;
  }

  private getActiveArrowPulseDirection(now = Date.now()): GlassArrowPulseDirection {
    if (this.arrowPulseDirection === 'none') {
      return 'none';
    }

    if (now >= this.arrowPulseExpiresAt) {
      this.arrowPulseDirection = 'none';
      return 'none';
    }

    return this.arrowPulseDirection;
  }

  private clampSignalBarBucket(bucket: number) {
    return Math.max(0, Math.min(10, Math.round(bucket)));
  }

  private isScriptedSignalAnimating(portraitState: GlassPortraitState, now: number) {
    if (portraitState.signalAnimationMode !== 'scripted_text') {
      return false;
    }

    const elapsedMs = now - portraitState.scriptedSignalStartedAt;
    return elapsedMs >= 0 && elapsedMs < portraitState.scriptedSignalDurationMs;
  }

  private resolveCenterSignalBarBucket(portraitState: GlassPortraitState, now: number) {
    if (!this.isScriptedSignalAnimating(portraitState, now)) {
      return portraitState.barBucket;
    }

    const elapsedMs = Math.max(0, now - portraitState.scriptedSignalStartedAt);
    const progress = Math.min(1, elapsedMs / Math.max(1, portraitState.scriptedSignalDurationMs));
    const base = Math.max(2, portraitState.barBucket);
    const seed = portraitState.scriptedSignalSeed % 97;
    const waveA = Math.sin((elapsedMs / 160) + seed * 0.21);
    const waveB = Math.sin((elapsedMs / 96) + seed * 0.11) * 0.65;
    const envelope = 1.35 - progress * 0.7;
    const variation = Math.round((waveA + waveB) * 2.2 * envelope + 1.3);
    return this.clampSignalBarBucket(base + variation);
  }
}

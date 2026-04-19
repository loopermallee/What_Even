import { CONTACTS } from '../app/contacts';
import type { AppStore } from '../app/state';
import type { NormalizedInput, RawEventDebugInfo } from '../app/types';
import type { BridgePagePayload } from '../bridge/startupLifecycle';
import { CreateStartUpPageContainer, TextContainerProperty } from '@evenrealities/even_hub_sdk';
import { selectActionItemsForGlasses, selectDialogueForGlasses, selectGlassPortraitState, selectGlassScreenView } from './selectors';
import { CONTACTS_LAYOUT, GLASSES_CONTAINERS, type GlassPortraitState } from './shared';

export type InputHandleResult = {
  changed: boolean;
  requestClose: boolean;
};

export class AppGlasses {
  private readonly store: AppStore;
  private readonly cursorBlinkIntervalMs = 520;

  constructor(store: AppStore) {
    this.store = store;
  }

  private getView() {
    return selectGlassScreenView(this.store.getState());
  }

  getPortraitAssetKey() {
    return this.getView().showPortrait ? this.getView().portraitAsset ?? null : null;
  }

  getPortraitState(): GlassPortraitState {
    return selectGlassPortraitState(this.store.getState());
  }

  getActionSeedIndex() {
    const view = this.getView();
    return view.showActions ? view.selectedActionIndex : null;
  }

  getDialogueText() {
    return selectDialogueForGlasses(this.store.getState(), this.isCursorVisible());
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

  private isCursorVisible() {
    return Math.floor(Date.now() / this.cursorBlinkIntervalMs) % 2 === 0;
  }

  handleNormalizedInput(input: NormalizedInput, inspection: RawEventDebugInfo): InputHandleResult {
    const previousState = this.store.getState();
    this.store.setLastInput(input, inspection);
    const resolvedSelectionIndex = this.applyListSelectionFromInspection(inspection);
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
        this.store.moveContactSelection(-1);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.moveContactSelection(1);
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
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
      if (state.listeningMode === 'capture') {
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

        if (selectedActionIndex === 0) {
          this.store.transmitCurrentUserTurn();
          return { changed: true, requestClose: false };
        }

        if (selectedActionIndex === 1) {
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

  private applyListSelectionFromInspection(inspection: RawEventDebugInfo) {
    if (inspection.source !== 'listEvent') {
      return null;
    }

    const resolvedIndex = this.resolveListSelectionIndex(inspection);
    if (resolvedIndex === null) {
      return null;
    }

    this.applyListSelectionFromIndex(resolvedIndex);
    return resolvedIndex;
  }

  private resolveListSelectionIndex(inspection: RawEventDebugInfo) {
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
    const listObject = view.showActions ? [this.buildStatusListContainer()] : [];

    return {
      containerTotalNum: textObject.length + listObject.length,
      textObject,
      listObject: listObject.length > 0 ? listObject : undefined,
    };
  }

  buildRebuildContainer(): BridgePagePayload {
    const view = this.getView();
    const textObject = this.buildTextContainers();
    const imageObject = view.showPortrait ? [this.buildPortraitImageContainer()] : [];
    const listObject = view.showActions ? [this.buildStatusListContainer()] : [];

    return {
      containerTotalNum: textObject.length + imageObject.length + listObject.length,
      imageObject: imageObject.length > 0 ? imageObject : undefined,
      textObject,
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

      this.store.setSelectedContactIndex(index);
      return;
    }

    if (state.screen === 'active') {
      this.store.setActiveActionIndex(index);
      return;
    }

    if (state.screen === 'listening' && state.listeningMode === 'actions') {
      this.store.setListeningActionIndex(index);
      return;
    }

    if (state.screen === 'ended') {
      this.store.setEndedActionIndex(index);
    }
  }

  private buildTextContainers() {
    const textObject: NonNullable<BridgePagePayload['textObject']> = [this.buildDialogueContainer()];
    const footer = this.buildFooterContainer();

    if (footer) {
      textObject.push(footer);
    }

    return textObject;
  }

  private buildDialogueContainer() {
    const view = this.getView();
    if (this.store.getState().screen === 'contacts') {
      return {
        ...CONTACTS_LAYOUT.panel,
        containerID: GLASSES_CONTAINERS.dialogueText.id,
        containerName: GLASSES_CONTAINERS.dialogueText.name,
        content: view.dialogue,
        isEventCapture: view.dialogueCapturesInput ? 1 : 0,
      };
    }

    const wide = !view.showPortrait;
    const tall = !view.showActions;

    return {
      xPosition: wide ? 24 : 132,
      yPosition: 38,
      width: wide ? 322 : 238,
      height: tall ? 170 : 126,
      containerID: GLASSES_CONTAINERS.dialogueText.id,
      containerName: GLASSES_CONTAINERS.dialogueText.name,
      content: this.getDialogueText(),
      isEventCapture: view.dialogueCapturesInput ? 1 : 0,
    };
  }

  private buildFooterContainer() {
    const view = this.getView();
    if (this.store.getState().screen === 'contacts') {
      return null;
    }

    if (!view.footerLabel) {
      return null;
    }

    return {
      xPosition: 24,
      yPosition: 236,
      width: 528,
      height: 24,
      containerID: GLASSES_CONTAINERS.footerText.id,
      containerName: GLASSES_CONTAINERS.footerText.name,
      content: view.footerLabel,
      isEventCapture: 0,
    };
  }

  private buildStatusListContainer() {
    const view = this.getView();
    const actions = this.getActionItems();
    if (this.store.getState().screen === 'contacts') {
      return {
        xPosition: 84,
        yPosition: 93,
        width: 408,
        height: 96,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        containerID: GLASSES_CONTAINERS.statusList.id,
        containerName: GLASSES_CONTAINERS.statusList.name,
        itemContainer: {
          itemCount: actions.length,
          itemName: actions,
          itemWidth: 0,
          isItemSelectBorderEn: 1,
        },
        isEventCapture: 1,
      };
    }

    return {
      xPosition: view.showPortrait ? 132 : 24,
      yPosition: view.showPortrait ? 182 : 196,
      width: view.showPortrait ? 190 : 236,
      height: 72,
      containerID: GLASSES_CONTAINERS.statusList.id,
      containerName: GLASSES_CONTAINERS.statusList.name,
      itemContainer: {
        itemCount: actions.length,
        itemName: actions,
        itemWidth: 0,
        isItemSelectBorderEn: 1,
      },
      isEventCapture: 1,
    };
  }

  private buildPortraitImageContainer() {
    return {
      xPosition: 22,
      yPosition: 42,
      width: 96,
      height: 96,
      containerID: GLASSES_CONTAINERS.portraitImage.id,
      containerName: GLASSES_CONTAINERS.portraitImage.name,
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
}

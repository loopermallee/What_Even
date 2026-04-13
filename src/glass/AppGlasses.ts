import type { AppStore } from '../app/state';
import type { NormalizedInput, RawEventDebugInfo } from '../app/types';
import type { BridgePagePayload } from '../bridge/startupLifecycle';
import { selectActionItemsForGlasses, selectDialogueForGlasses, selectGlassScreenView } from './selectors';
import { GLASSES_CONTAINERS } from './shared';

export type InputHandleResult = {
  changed: boolean;
  requestClose: boolean;
};

export class AppGlasses {
  private readonly store: AppStore;

  constructor(store: AppStore) {
    this.store = store;
  }

  getPortraitAssetKey() {
    return selectGlassScreenView(this.store.getState()).portraitAsset;
  }

  getActionSeedIndex() {
    const view = selectGlassScreenView(this.store.getState());
    return view.selectedActionIndex;
  }

  getDialogueText() {
    return selectDialogueForGlasses(this.store.getState());
  }

  getActionItems() {
    return selectActionItemsForGlasses(this.store.getState());
  }

  handleNormalizedInput(input: NormalizedInput, inspection: RawEventDebugInfo): InputHandleResult {
    this.store.setLastInput(input, inspection);
    const state = this.store.getState();

    if (input === 'AT_TOP' || input === 'AT_BOTTOM') {
      return { changed: false, requestClose: false };
    }

    if (inspection.source === 'listEvent' && inspection.currentSelectItemIndex !== null) {
      this.applyListSelectionFromIndex(inspection.currentSelectItemIndex);
    }

    if (state.screen === 'debug') {
      if (input === 'TAP' || input === 'DOUBLE_TAP') {
        this.store.exitDebugScreen();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'contacts') {
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
      if (input === 'UP') {
        this.store.setIncomingActionIndex(0);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.setIncomingActionIndex(1);
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        if (this.store.getState().incomingActionIndex === 0) {
          this.store.answerIncomingAndStartListening();
        } else {
          this.store.ignoreIncoming();
        }
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: input === 'DOUBLE_TAP' };
    }

    if (state.screen === 'listening') {
      if (input === 'UP') {
        this.store.setListeningActionIndex(0);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.setListeningActionIndex(1);
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        if (this.store.getState().listeningActionIndex === 0) {
          this.store.continueListeningAndStartActiveCall();
        } else {
          this.store.endListening();
        }

        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        this.store.endListening();
        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'active') {
      if (input === 'UP') {
        this.store.setActiveActionIndex(0);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.setActiveActionIndex(1);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        this.store.endCall();
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        if (this.store.getState().activeActionIndex === 0) {
          this.store.advanceDialogueOrEnd();
        } else {
          this.store.endCall();
        }

        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: false };
    }

    if (state.screen === 'ended') {
      if (input === 'UP') {
        this.store.setEndedActionIndex(0);
        return { changed: true, requestClose: false };
      }

      if (input === 'DOWN') {
        this.store.setEndedActionIndex(1);
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        if (this.store.getState().endedActionIndex === 0) {
          this.store.redialCurrentContact();
        } else {
          this.store.backToContacts();
        }

        return { changed: true, requestClose: false };
      }

      return { changed: false, requestClose: input === 'DOUBLE_TAP' };
    }

    return { changed: false, requestClose: false };
  }

  buildMinimalStartContainer(): BridgePagePayload {
    return {
      containerTotalNum: 1,
      listObject: [this.buildStatusListContainer()],
    };
  }

  buildTextOnlyRebuildContainer(): BridgePagePayload {
    return {
      containerTotalNum: 2,
      textObject: [this.buildDialogueContainer()],
      listObject: [this.buildStatusListContainer()],
    };
  }

  buildRebuildContainer(): BridgePagePayload {
    return {
      containerTotalNum: 3,
      imageObject: [this.buildPortraitImageContainer()],
      textObject: [this.buildDialogueContainer()],
      listObject: [this.buildStatusListContainer()],
    };
  }

  private applyListSelectionFromIndex(index: number) {
    const state = this.store.getState();

    if (state.screen === 'contacts') {
      this.store.setSelectedContactIndex(index);
      return;
    }

    if (state.screen === 'incoming') {
      this.store.setIncomingActionIndex(index);
      return;
    }

    if (state.screen === 'active') {
      this.store.setActiveActionIndex(index);
      return;
    }

    if (state.screen === 'listening') {
      this.store.setListeningActionIndex(index);
      return;
    }

    if (state.screen === 'ended') {
      this.store.setEndedActionIndex(index);
    }
  }

  private buildDialogueContainer() {
    return {
      xPosition: 132,
      yPosition: 38,
      width: 238,
      height: 126,
      containerID: GLASSES_CONTAINERS.dialogueText.id,
      containerName: GLASSES_CONTAINERS.dialogueText.name,
      content: this.getDialogueText(),
      isEventCapture: 0,
    };
  }

  private buildStatusListContainer() {
    const actions = this.getActionItems();

    return {
      xPosition: 132,
      yPosition: 182,
      width: 190,
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
}

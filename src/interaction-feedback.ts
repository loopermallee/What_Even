export type RawInteractionType = 'up' | 'down' | 'click' | 'double_click';

export type FeedbackSource = 'raw' | 'action';

export type InteractionFeedbackItem = {
  id: number;
  interaction: RawInteractionType;
  source: FeedbackSource;
  createdAt: number;
  expiresAt: number;
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

type InteractionFeedbackManagerOptions = {
  onFeedbackAdded?: (item: InteractionFeedbackItem) => void;
  onFeedbackRemoved?: (item: InteractionFeedbackItem) => void;
  onRawInteraction?: (interaction: RawInteractionType) => void;
  onActionCommitted?: (interaction: RawInteractionType) => void;
  onDebugMessage?: (message: string) => void;
};

const FEEDBACK_TTL_MS: Record<RawInteractionType, number> = {
  up: 290,
  down: 290,
  click: 340,
  double_click: 420,
};

export class InteractionFeedbackManager {
  private readonly onFeedbackAdded?: (item: InteractionFeedbackItem) => void;
  private readonly onFeedbackRemoved?: (item: InteractionFeedbackItem) => void;
  private readonly onRawInteraction?: (interaction: RawInteractionType) => void;
  private readonly onActionCommitted?: (interaction: RawInteractionType) => void;
  private readonly onDebugMessage?: (message: string) => void;
  private nextId = 1;
  private activeItems = new Map<number, InteractionFeedbackItem>();
  private removeTimers = new Map<number, TimeoutHandle>();
  private lastCommittedDoubleAtMs = 0;

  constructor(options: InteractionFeedbackManagerOptions = {}) {
    this.onFeedbackAdded = options.onFeedbackAdded;
    this.onFeedbackRemoved = options.onFeedbackRemoved;
    this.onRawInteraction = options.onRawInteraction;
    this.onActionCommitted = options.onActionCommitted;
    this.onDebugMessage = options.onDebugMessage;
  }

  getActiveItems() {
    return Array.from(this.activeItems.values()).sort((a, b) => a.id - b.id);
  }

  handleRawInteraction(interaction: RawInteractionType) {
    this.onRawInteraction?.(interaction);
    this.debug(`raw interaction received: ${interaction}`);
    this.emitFeedback(interaction, 'raw');
    this.commitAction(interaction);
  }

  dispose() {
    for (const timer of this.removeTimers.values()) {
      clearTimeout(timer);
    }

    this.removeTimers.clear();
    this.activeItems.clear();
  }

  private commitAction(interaction: RawInteractionType) {
    if (interaction === 'double_click') {
      const now = Date.now();
      if (now - this.lastCommittedDoubleAtMs < 120) {
        this.debug('double-click action deduplicated due to short cooldown');
        return;
      }

      this.lastCommittedDoubleAtMs = now;
    }

    this.debug(`action committed: ${interaction}`);
    this.onActionCommitted?.(interaction);
  }

  private emitFeedback(interaction: RawInteractionType, source: FeedbackSource) {
    const now = Date.now();
    const ttl = FEEDBACK_TTL_MS[interaction];

    const item: InteractionFeedbackItem = {
      id: this.nextId++,
      interaction,
      source,
      createdAt: now,
      expiresAt: now + ttl,
    };

    this.activeItems.set(item.id, item);
    this.debug(`feedback item created: #${item.id} (${item.interaction})`);
    this.onFeedbackAdded?.(item);

    const timer = setTimeout(() => {
      this.removeTimers.delete(item.id);
      this.activeItems.delete(item.id);
      this.debug(`feedback item removed: #${item.id}`);
      this.onFeedbackRemoved?.(item);
    }, ttl);

    this.removeTimers.set(item.id, timer);
  }

  private debug(message: string) {
    this.onDebugMessage?.(message);
  }
}

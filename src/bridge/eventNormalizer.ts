import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { EventBranchSource, NormalizedInput, RawEventDebugInfo } from '../app/types';
import { GLASSES_CONTAINERS } from '../glass/shared';

type InputInspection = RawEventDebugInfo;

type EventBranch = {
  source: EventBranchSource;
  payload: Record<string, unknown>;
};

function formatRawEventType(rawType: unknown) {
  if (typeof rawType === 'number') {
    return OsEventTypeList[rawType] ?? String(rawType);
  }

  if (typeof rawType === 'string') {
    return rawType;
  }

  if (rawType === null || rawType === undefined) {
    return 'UNKNOWN_EVENT';
  }

  return String(rawType);
}

function normalizeTypeToken(rawType: unknown) {
  return formatRawEventType(rawType)
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

function collectEventTypeCandidates(payload: Record<string, unknown>, event: EvenHubEvent) {
  const candidates: string[] = [];

  const pushCandidate = (value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }

    const token = normalizeTypeToken(value);
    if (!token || candidates.includes(token)) {
      return;
    }

    candidates.push(token);
  };

  pushCandidate(payload.eventType);
  pushCandidate(payload.Event_Type);
  pushCandidate(payload.event_type);
  pushCandidate(payload.type);

  if (event.jsonData) {
    const data = event.jsonData as Record<string, unknown>;
    pushCandidate(data.eventType);
    pushCandidate(data.Event_Type);
    pushCandidate(data.event_type);
    pushCandidate(data.type);
  }

  return candidates;
}

function getAllEventBranches(event: EvenHubEvent) {
  const branches: EventBranch[] = [];

  if (event.listEvent) {
    branches.push({
      source: 'listEvent',
      payload: event.listEvent as unknown as Record<string, unknown>,
    });
  }

  if (event.textEvent) {
    branches.push({
      source: 'textEvent',
      payload: event.textEvent as unknown as Record<string, unknown>,
    });
  }

  if (event.sysEvent) {
    branches.push({
      source: 'sysEvent',
      payload: event.sysEvent as unknown as Record<string, unknown>,
    });
  }

  if (branches.length === 0) {
    branches.push({
      source: 'unknown',
      payload: (event.jsonData ?? {}) as Record<string, unknown>,
    });
  }

  return branches;
}

function inspectInputEvent(source: EventBranchSource, payload: Record<string, unknown>, event: EvenHubEvent): InputInspection {
  const rawEventType = payload.eventType ?? payload.Event_Type ?? payload.event_type ?? null;
  const rawEventTypeName = formatRawEventType(rawEventType);

  const containerID = typeof payload.containerID === 'number'
    ? payload.containerID
    : typeof payload.Container_ID === 'number'
      ? payload.Container_ID
      : null;

  const containerName = typeof payload.containerName === 'string'
    ? payload.containerName
    : typeof payload.Container_Name === 'string'
      ? payload.Container_Name
      : null;

  const currentSelectItemName = typeof payload.currentSelectItemName === 'string'
    ? payload.currentSelectItemName
    : typeof payload.CurrentSelect_ItemName === 'string'
      ? payload.CurrentSelect_ItemName
      : null;

  const currentSelectItemIndex = typeof payload.currentSelectItemIndex === 'number'
    ? payload.currentSelectItemIndex
    : typeof payload.CurrentSelect_ItemIndex === 'number'
      ? payload.CurrentSelect_ItemIndex
      : null;

  const eventTypeCandidates = collectEventTypeCandidates(payload, event);
  const normalizedTypeToken = eventTypeCandidates[0] ?? normalizeTypeToken(rawEventType);
  const rawListEventFieldKeys = source === 'listEvent'
    ? Object.keys(payload).sort((left, right) => left.localeCompare(right))
    : [];
  const rawListEventFieldSummary = source === 'listEvent'
    ? summarizeListEventPayload(payload)
    : null;

  return {
    source,
    rawEventTypeName,
    normalizedTypeToken,
    eventTypeCandidates,
    containerID,
    containerName,
    currentSelectItemName,
    currentSelectItemIndex,
    rawListEventFieldKeys,
    rawListEventFieldSummary,
  };
}

function summarizeListEventPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${formatFieldValue(value)}`);

  return entries.length > 0 ? entries.join(', ') : 'none';
}

function formatFieldValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[len:${value.length}]`;
  }

  if (value && typeof value === 'object') {
    return '{...}';
  }

  return String(value);
}

function isBoundaryToken(token: string) {
  return (
    token === 'SCROLL_TOP_EVENT' ||
    token === 'SCROLL_TOP' ||
    token === 'REACHED_TOP_EVENT' ||
    token === 'AT_TOP_EVENT' ||
    token === 'SCROLL_BOTTOM_EVENT' ||
    token === 'SCROLL_BOTTOM' ||
    token === 'REACHED_BOTTOM_EVENT' ||
    token === 'AT_BOTTOM_EVENT'
  );
}

function isListTapToken(token: string) {
  return (
    token === 'CLICK_EVENT' ||
    token === 'CLICK' ||
    token === 'SINGLE_CLICK_EVENT' ||
    token === 'SINGLE_CLICK' ||
    token === 'ENTER_EVENT' ||
    token === 'ENTER' ||
    token === 'TAP_EVENT' ||
    token === 'TAP' ||
    token === 'SELECT_EVENT' ||
    token === 'SELECT' ||
    token === 'CONFIRM_EVENT' ||
    token === 'CONFIRM' ||
    token === 'OK_EVENT' ||
    token === 'OK' ||
    token === 'UNKNOWN_EVENT'
  );
}

function normalizeInputFromTypeToken(inspection: InputInspection): NormalizedInput | null {
  const tokens = inspection.eventTypeCandidates.length > 0
    ? inspection.eventTypeCandidates
    : [inspection.normalizedTypeToken];

  for (const token of tokens) {
    if (
      token === 'SCROLL_TOP_EVENT' ||
      token === 'SCROLL_TOP' ||
      token === 'REACHED_TOP_EVENT' ||
      token === 'AT_TOP_EVENT'
    ) {
      return 'AT_TOP';
    }

    if (
      token === 'SCROLL_BOTTOM_EVENT' ||
      token === 'SCROLL_BOTTOM' ||
      token === 'REACHED_BOTTOM_EVENT' ||
      token === 'AT_BOTTOM_EVENT'
    ) {
      return 'AT_BOTTOM';
    }

    if (
      token === 'DOUBLE_CLICK_EVENT' ||
      token === 'DOUBLE_CLICK' ||
      token === 'DOUBLE_TAP_EVENT' ||
      token === 'DOUBLE_TAP' ||
      token === 'DOUBLE_ENTER_EVENT'
    ) {
      return 'DOUBLE_TAP';
    }

    if (
      token === 'SCROLL_UP_EVENT' ||
      token === 'SCROLL_UP' ||
      token === 'MOVE_UP_EVENT' ||
      token === 'MOVE_UP' ||
      token === 'NAV_UP_EVENT' ||
      token === 'UP_EVENT' ||
      token === 'UP'
    ) {
      return 'UP';
    }

    if (
      token === 'SCROLL_DOWN_EVENT' ||
      token === 'SCROLL_DOWN' ||
      token === 'MOVE_DOWN_EVENT' ||
      token === 'MOVE_DOWN' ||
      token === 'NAV_DOWN_EVENT' ||
      token === 'DOWN_EVENT' ||
      token === 'DOWN'
    ) {
      return 'DOWN';
    }

    if (
      token === 'CLICK_EVENT' ||
      token === 'CLICK' ||
      token === 'SINGLE_CLICK_EVENT' ||
      token === 'SINGLE_CLICK' ||
      token === 'ENTER_EVENT' ||
      token === 'ENTER' ||
      token === 'TAP_EVENT' ||
      token === 'TAP' ||
      token === 'SELECT_EVENT' ||
      token === 'SELECT' ||
      token === 'CONFIRM_EVENT' ||
      token === 'CONFIRM' ||
      token === 'OK_EVENT' ||
      token === 'OK'
    ) {
      return 'TAP';
    }
  }

  return null;
}

function buildListContainerKey(inspection: InputInspection) {
  if (inspection.source !== 'listEvent') {
    return null;
  }

  const idPart = inspection.containerID !== null ? `id:${inspection.containerID}` : 'id:-';
  const namePart = inspection.containerName ?? '-';
  return `${inspection.source}|${idPart}|name:${namePart}`;
}

function isStatusListContainer(inspection: InputInspection) {
  return (
    inspection.source === 'listEvent' &&
    inspection.containerID === GLASSES_CONTAINERS.statusList.id &&
    inspection.containerName === GLASSES_CONTAINERS.statusList.name
  );
}

function getInspectionTokens(inspection: InputInspection) {
  return inspection.eventTypeCandidates.length > 0
    ? inspection.eventTypeCandidates
    : [inspection.normalizedTypeToken];
}

function isSimulatorStatusListUnknownTap(inspection: InputInspection) {
  if (inspection.source !== 'listEvent') {
    return false;
  }

  if (!isStatusListContainer(inspection)) {
    return false;
  }

  const tokens = getInspectionTokens(inspection);
  if (!tokens.every((token) => token === 'UNKNOWN_EVENT')) {
    return false;
  }

  return inspection.currentSelectItemIndex !== null || inspection.currentSelectItemName !== null;
}

function isSimulatorStatusListTapFallback(inspection: InputInspection) {
  if (!isStatusListContainer(inspection)) {
    return false;
  }

  if (inspection.currentSelectItemIndex !== null || inspection.currentSelectItemName !== null) {
    return false;
  }

  return getInspectionTokens(inspection).every((token) => token === 'UNKNOWN_EVENT');
}

export class EvenInputNormalizer {
  private readonly lastListIndexByContainer = new Map<string, number>();

  clear() {
    this.lastListIndexByContainer.clear();
  }

  seedListIndex(containerID: number, containerName: string, index = 0) {
    this.lastListIndexByContainer.set(`listEvent|id:${containerID}|name:${containerName}`, index);
  }

  normalize(event: EvenHubEvent) {
    const outputs: Array<{ inspection: InputInspection; input: NormalizedInput | null; logLine: string }> = [];

    for (const branch of getAllEventBranches(event)) {
      const inspection = inspectInputEvent(branch.source, branch.payload, event);
      const input = this.normalizeInspection(inspection);
      const logParts = [
        `Input source: ${inspection.source}`,
        `rawEventType: ${inspection.rawEventTypeName}`,
        `containerID: ${inspection.containerID ?? '-'}`,
        `containerName: ${inspection.containerName ?? '-'}`,
      ];

      if (inspection.currentSelectItemName !== null) {
        logParts.push(`currentSelectItemName: ${inspection.currentSelectItemName}`);
      }

      if (inspection.currentSelectItemIndex !== null) {
        logParts.push(`index: ${inspection.currentSelectItemIndex}`);
      }

      if (inspection.source === 'listEvent') {
        logParts.push(`listFields: ${inspection.rawListEventFieldSummary ?? 'none'}`);
      }

      const logLine = input
        ? `${logParts.join(' | ')} | normalized: ${input}`
        : `${logParts.join(' | ')} | normalized: NONE (candidates: ${inspection.eventTypeCandidates.join(', ') || 'none'})`;

      outputs.push({ inspection, input, logLine });
    }

    return outputs;
  }

  private normalizeInspection(inspection: InputInspection): NormalizedInput | null {
    if (isSimulatorStatusListUnknownTap(inspection)) {
      return 'TAP';
    }

    const movement = this.getMovementFromListIndex(inspection);
    if (movement) {
      return movement;
    }

    if (inspection.source === 'listEvent') {
      const tokens = getInspectionTokens(inspection);

      if (tokens.some((token) => isBoundaryToken(token))) {
        return normalizeInputFromTypeToken(inspection);
      }

      if (tokens.some((token) =>
        token === 'DOUBLE_CLICK_EVENT' ||
        token === 'DOUBLE_CLICK' ||
        token === 'DOUBLE_TAP_EVENT' ||
        token === 'DOUBLE_TAP' ||
        token === 'DOUBLE_ENTER_EVENT')) {
        return 'DOUBLE_TAP';
      }

      if ((inspection.currentSelectItemName !== null || inspection.currentSelectItemIndex !== null) &&
        tokens.some((token) => isListTapToken(token))) {
        return 'TAP';
      }

      if (isSimulatorStatusListTapFallback(inspection)) {
        return 'TAP';
      }
    }

    return normalizeInputFromTypeToken(inspection);
  }

  private getMovementFromListIndex(inspection: InputInspection): NormalizedInput | null {
    if (inspection.source !== 'listEvent' || inspection.currentSelectItemIndex === null) {
      return null;
    }

    if (!isStatusListContainer(inspection)) {
      return null;
    }

    if (isSimulatorStatusListUnknownTap(inspection)) {
      return null;
    }

    const key = buildListContainerKey(inspection);
    if (!key) {
      return null;
    }

    const previous = this.lastListIndexByContainer.get(key);
    this.lastListIndexByContainer.set(key, inspection.currentSelectItemIndex);

    if (previous === undefined || previous === inspection.currentSelectItemIndex) {
      return null;
    }

    return inspection.currentSelectItemIndex > previous ? 'DOWN' : 'UP';
  }
}

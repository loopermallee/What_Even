import { CONTACTS, RIGHT_CHARACTER } from '../app/contacts';
import type { AppState } from '../app/types';

export type PortraitAsset = 'portrait-colonel' | 'portrait-meryl' | 'portrait-otacon' | 'portrait-snake';

export const GLASSES_CONTAINERS = {
  portraitImage: { id: 101, name: 'codec-face' },
  dialogueText: { id: 102, name: 'codec-dialog' },
  statusList: { id: 103, name: 'codec-status' },
} as const;

export type GlassScreenView = {
  screenLabel: string;
  portraitAsset: PortraitAsset;
  dialogue: string;
  actions: string[];
  selectedActionIndex: number;
};

export function wrapText(content: string, maxCharsPerLine: number, maxLines: number) {
  const rows: string[] = [];

  for (const block of content.split('\n')) {
    const words = block.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      rows.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        line = next;
        continue;
      }

      if (line) {
        rows.push(line);
      }
      line = word;
    }

    if (line) {
      rows.push(line);
    }
  }

  return rows.slice(0, maxLines).join('\n');
}

export function getSelectedContact(state: AppState) {
  return CONTACTS[state.selectedContactIndex] ?? CONTACTS[0];
}

export function getPortraitAssetForContactName(name: string): PortraitAsset {
  if (name === 'Colonel') {
    return 'portrait-colonel';
  }

  if (name === 'Meryl') {
    return 'portrait-meryl';
  }

  if (name === 'Otacon') {
    return 'portrait-otacon';
  }

  return 'portrait-snake';
}

export function getPortraitAssetForState(state: AppState): PortraitAsset {
  const contact = getSelectedContact(state);

  if (state.screen === 'active' && state.dialogueIndex >= 0) {
    const line = contact.dialogue[state.dialogueIndex];
    if (line?.speaker === 'right') {
      return 'portrait-snake';
    }
  }

  return getPortraitAssetForContactName(contact.name);
}

export function getCurrentSpeakerName(state: AppState) {
  const contact = getSelectedContact(state);
  if (state.dialogueIndex < 0) {
    return contact.name.toUpperCase();
  }

  const line = contact.dialogue[state.dialogueIndex];
  if (!line) {
    return contact.name.toUpperCase();
  }

  return (line.speaker === 'left' ? contact.name : RIGHT_CHARACTER.name).toUpperCase();
}

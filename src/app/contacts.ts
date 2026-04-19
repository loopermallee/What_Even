import type { AppState, CodecCharacterId, Contact } from './types';

export const RIGHT_CHARACTER = {
  name: 'Snake',
  code: 'SNAKE',
  portraitTag: 'SN',
  characterId: 'snake' as CodecCharacterId,
};

export const CONTACTS: Contact[] = [
  {
    name: 'Colonel',
    code: 'CMD',
    frequency: '140.85',
    portraitTag: 'CO',
    characterId: 'colonel',
    greeting: 'You called?',
    ackStyle: 'Understood. I have your update.',
    signoff: 'Report back after the next checkpoint.',
    dialogue: [
      { speaker: 'left', text: 'Snake, codec check. Your signal is stable now.', emotion: 'stern' },
      { speaker: 'right', text: 'I read you. What is the situation?' },
      { speaker: 'left', text: 'Stay low, move carefully, and avoid drawing attention.', emotion: 'stern' },
      { speaker: 'right', text: 'Understood. I will move once the path is clear.' },
    ],
  },
  {
    name: 'Otacon',
    code: 'ENG',
    frequency: '141.12',
    portraitTag: 'OT',
    characterId: 'otacon',
    greeting: 'Uh, you called? I am here.',
    ackStyle: 'Okay, got it. I am tracking that now.',
    signoff: 'I need to get back to the system feed.',
    dialogue: [
      { speaker: 'left', text: 'Snake, I can keep an eye on the system feed from here.', emotion: 'thinking' },
      { speaker: 'right', text: 'Good. Let me know if anything changes.' },
      { speaker: 'left', text: 'If the patrol route shifts, I will call it out immediately.' },
      { speaker: 'right', text: 'That is all I need. Stay sharp.' },
    ],
  },
  {
    name: 'Meryl',
    code: 'ALY',
    frequency: '140.15',
    portraitTag: 'MR',
    characterId: 'meryl',
    greeting: 'You called?',
    ackStyle: 'Copy. I heard you.',
    signoff: 'I have to move before this window closes.',
    dialogue: [
      { speaker: 'left', text: 'Snake, I am in position. The route ahead is still open.' },
      { speaker: 'right', text: 'Good. Keep your head down and do not rush it.' },
      { speaker: 'left', text: 'Relax. I know what I am doing.', emotion: 'angry' },
      { speaker: 'right', text: 'Fine. Just stay on comms.' },
    ],
  },
  {
    name: 'Mei Ling',
    code: 'NAV',
    frequency: '140.96',
    portraitTag: 'ML',
    characterId: 'meiling',
    greeting: 'Mei Ling here. Ready when you are.',
    ackStyle: 'Understood. I am logging that now.',
    signoff: 'Stay focused. I will keep this channel ready.',
    dialogue: [
      { speaker: 'left', text: 'Snake, your route window is still open. Keep moving while the patrol timing holds.', emotion: 'thinking' },
      { speaker: 'right', text: 'Copy that. Keep tracking the route for me.' },
      { speaker: 'left', text: 'I will update you if the pattern changes. Trust your timing and stay calm.' },
      { speaker: 'right', text: 'Understood. I am moving now.' },
    ],
  },
];

export function clampContactIndex(index: number | null | undefined) {
  if (CONTACTS.length === 0) {
    return 0;
  }

  if (typeof index !== 'number' || !Number.isInteger(index)) {
    return 0;
  }

  const normalized = index % CONTACTS.length;
  return normalized >= 0 ? normalized : normalized + CONTACTS.length;
}

export function getContactByIndex(index: number | null | undefined) {
  return CONTACTS[clampContactIndex(index)] ?? CONTACTS[0];
}

export function getCurrentContactIndex(state: Pick<AppState, 'selectedContactIndex' | 'engagedContactIndex'>) {
  return clampContactIndex(state.engagedContactIndex ?? state.selectedContactIndex);
}

export function getCurrentContact(state: Pick<AppState, 'selectedContactIndex' | 'engagedContactIndex'>) {
  return getContactByIndex(getCurrentContactIndex(state));
}

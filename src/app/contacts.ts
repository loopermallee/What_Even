import type { Contact } from './types';

export const RIGHT_CHARACTER = {
  name: 'Snake',
  code: 'SNAKE',
  portraitTag: 'SN',
};

export const CONTACTS: Contact[] = [
  {
    name: 'Colonel',
    code: 'CMD',
    frequency: '140.85',
    portraitTag: 'CO',
    dialogue: [
      { speaker: 'left', text: 'Snake, codec check. Your signal is stable now.' },
      { speaker: 'right', text: 'I read you. What is the situation?' },
      { speaker: 'left', text: 'Stay low, move carefully, and avoid drawing attention.' },
      { speaker: 'right', text: 'Understood. I will move once the path is clear.' },
    ],
  },
  {
    name: 'Otacon',
    code: 'ENG',
    frequency: '141.12',
    portraitTag: 'OT',
    dialogue: [
      { speaker: 'left', text: 'Snake, I can keep an eye on the system feed from here.' },
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
    dialogue: [
      { speaker: 'left', text: 'Snake, I am in position. The route ahead is still open.' },
      { speaker: 'right', text: 'Good. Keep your head down and do not rush it.' },
      { speaker: 'left', text: 'Relax. I know what I am doing.' },
      { speaker: 'right', text: 'Fine. Just stay on comms.' },
    ],
  },
];

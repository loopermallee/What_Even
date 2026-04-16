import type { Contact, TranscriptEntry } from './types';

export type GeneratedTurn = Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>;

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

export function generateGreeting(contact: Contact): GeneratedTurn {
  return {
    role: 'contact',
    speaker: contact.name.toUpperCase(),
    text: contact.greeting,
    emotion: 'stern',
  };
}

export function generateDeterministicResponse(contact: Contact, userText: string): GeneratedTurn[] {
  const normalized = userText.trim().toLowerCase();
  const contactSpeaker = contact.name.toUpperCase();
  const lead = contact.ackStyle;
  const signoff = contact.signoff;

  if (hasAny(normalized, ['repeat', 'again', 'say that'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: `${lead} Repeating the last guidance: stay low, move steadily, and keep comms open.`,
        emotion: 'stern',
      },
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['status', 'update', 'report'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: `${lead} Status remains stable. No immediate threats on this channel.`,
        emotion: 'stern',
      },
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['where', 'position', 'location'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: `${lead} Current position is unchanged. Keep your route flexible and avoid open corridors.`,
        emotion: 'thinking',
      },
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['wait', 'hold'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: `${lead} Holding the line and watching for movement.`,
        emotion: 'thinking',
      },
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['help', 'support', 'backup'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: `${lead} I can support with updates and route checks.`,
        emotion: 'stern',
      },
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  return [
    {
      role: 'contact',
      speaker: contactSpeaker,
      text: `${lead} ${contact.name} is moving on it now.`,
      emotion: 'stern',
    },
    {
      role: 'system',
      speaker: 'SYSTEM',
      text: signoff,
    },
  ];
}

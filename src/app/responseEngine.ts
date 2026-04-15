import type { Contact, TranscriptEntry } from './types';

export type GeneratedTurn = Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>;

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

export function generateDeterministicResponse(contact: Contact, userText: string): GeneratedTurn[] {
  const normalized = userText.trim().toLowerCase();
  const contactSpeaker = contact.name.toUpperCase();

  if (hasAny(normalized, ['repeat', 'again', 'say that'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: 'Copy. Repeating the last guidance: stay low, move steadily, and keep comms open.',
        emotion: 'stern',
      },
    ];
  }

  if (hasAny(normalized, ['status', 'update', 'report'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: 'Status remains stable. No immediate threats on this channel.',
        emotion: 'stern',
      },
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: 'Codec link stable. Monitoring continues.',
      },
    ];
  }

  if (hasAny(normalized, ['where', 'position', 'location'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: 'Current position is unchanged. Keep your route flexible and avoid open corridors.',
        emotion: 'thinking',
      },
    ];
  }

  if (hasAny(normalized, ['wait', 'hold'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: 'Understood. Holding the line and watching for movement.',
        emotion: 'thinking',
      },
    ];
  }

  if (hasAny(normalized, ['help', 'support', 'backup'])) {
    return [
      {
        role: 'contact',
        speaker: contactSpeaker,
        text: 'I can support with updates and route checks. Tell me what you need next.',
        emotion: 'stern',
      },
    ];
  }

  return [
    {
      role: 'contact',
      speaker: contactSpeaker,
      text: `Copy that. ${contact.name} acknowledges and will keep feeding updates on this codec channel.`,
      emotion: 'stern',
    },
  ];
}

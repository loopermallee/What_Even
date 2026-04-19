import { applyCharacterResponseCap, getCharacterContract } from './ai/characterContracts';
import type { Contact, TranscriptEntry } from './types';

export type GeneratedTurn = Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'>;

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

const TACTICAL_DOMAIN_KEYWORDS = [
  'route',
  'patrol',
  'camera',
  'door',
  'checkpoint',
  'position',
  'location',
  'status',
  'update',
  'report',
  'move',
  'moving',
  'hold',
  'wait',
  'support',
  'backup',
  'system',
  'feed',
  'sensor',
  'timing',
  'window',
  'cover',
  'lane',
  'clear',
  'signal',
  'comms',
  'frequency',
];

const OUT_OF_DOMAIN_KEYWORDS = [
  'weather',
  'stock',
  'recipe',
  'movie',
  'music',
  'song',
  'president',
  'election',
  'history',
  'math',
  'equation',
  'code',
  'javascript',
  'typescript',
  'doctor',
  'medical',
  'disease',
  'planet',
  'celebrity',
  'restaurant',
  'capital of',
  'sport',
  'football',
  'basketball',
];

function seemsOutOfDomain(normalized: string) {
  if (hasAny(normalized, OUT_OF_DOMAIN_KEYWORDS)) {
    return true;
  }

  const looksLikeBroadQuestion = normalized.includes('?')
    || hasAny(normalized, ['who', 'what', 'when', 'why', 'how', 'explain', 'tell me']);
  if (!looksLikeBroadQuestion) {
    return false;
  }

  return !hasAny(normalized, TACTICAL_DOMAIN_KEYWORDS);
}

function getDeterministicEmotion(templateKey: keyof ReturnType<typeof getCharacterContract>['fallbackStyle']['templates']) {
  if (templateKey === 'location' || templateKey === 'hold') {
    return 'thinking' as const;
  }

  return 'stern' as const;
}

function buildContactReply(contact: Contact, templateKey: keyof ReturnType<typeof getCharacterContract>['fallbackStyle']['templates']) {
  const contract = getCharacterContract(contact);
  const template = contract.fallbackStyle.templates[templateKey];
  return {
    role: 'contact' as const,
    speaker: contact.name.toUpperCase(),
    text: applyCharacterResponseCap(template, contract),
    emotion: templateKey === 'unknown'
      ? contract.fallbackStyle.defaultEmotion
      : getDeterministicEmotion(templateKey),
  };
}

export function generateGreeting(contact: Contact): GeneratedTurn {
  const contract = getCharacterContract(contact);
  return {
    role: 'contact',
    speaker: contact.name.toUpperCase(),
    text: applyCharacterResponseCap(contact.greeting, contract),
    emotion: contract.fallbackStyle.defaultEmotion,
  };
}

export function generateDeterministicResponse(contact: Contact, userText: string): GeneratedTurn[] {
  const normalized = userText.trim().toLowerCase();
  const signoff = contact.signoff;

  if (hasAny(normalized, ['repeat', 'again', 'say that'])) {
    return [
      buildContactReply(contact, 'repeat'),
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['status', 'update', 'report'])) {
    return [
      buildContactReply(contact, 'status'),
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['where', 'position', 'location'])) {
    return [
      buildContactReply(contact, 'location'),
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['wait', 'hold'])) {
    return [
      buildContactReply(contact, 'hold'),
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (hasAny(normalized, ['help', 'support', 'backup'])) {
    return [
      buildContactReply(contact, 'support'),
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  if (seemsOutOfDomain(normalized)) {
    return [
      buildContactReply(contact, 'unknown'),
      {
        role: 'system',
        speaker: 'SYSTEM',
        text: signoff,
      },
    ];
  }

  return [
    buildContactReply(contact, 'default'),
    {
      role: 'system',
      speaker: 'SYSTEM',
      text: signoff,
    },
  ];
}

import type {
  CodecCharacterId,
  ScriptedLineMetadata,
  ScriptedScenario,
  ScriptedScenarioLine,
  TranscriptEntry,
} from './types';

function toRole(speaker: ScriptedScenarioLine['speaker']): TranscriptEntry['role'] {
  return speaker === 'right' ? 'user' : 'contact';
}

function toSpeakerLabel(speaker: ScriptedScenarioLine['speaker'], contactName: string) {
  return speaker === 'right' ? 'SNAKE' : contactName.toUpperCase();
}

export function createScriptedTranscriptTurns(options: {
  scenario: ScriptedScenario;
  contactName: string;
}): Array<Pick<TranscriptEntry, 'role' | 'speaker' | 'text' | 'emotion'> & { metadata?: ScriptedLineMetadata }> {
  return options.scenario.lines.map((line) => ({
    role: toRole(line.speaker),
    speaker: toSpeakerLabel(line.speaker, options.contactName),
    text: line.text,
    emotion: line.emotion,
    metadata: line.metadata,
  }));
}

const SCRIPTED_SCENARIOS: ScriptedScenario[] = [
  {
    id: 'colonel-route-correction',
    title: 'Route Correction',
    contactCharacterId: 'colonel',
    lines: [
      { speaker: 'left', text: 'Snake, stop. Your current route crosses a camera choke point.', emotion: 'stern', metadata: { cadence: 'measured', transitionIntensity: 'medium' } },
      { speaker: 'right', text: 'I see it. New route?', metadata: { cadence: 'brief', pauseAfterMs: 120 } },
      { speaker: 'left', text: 'Take the maintenance spine on your left. Two doors, then ladder access.', emotion: 'thinking', metadata: { cadence: 'measured' } },
      { speaker: 'right', text: 'Patrol timing.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Twenty-second gap, repeating every ninety. Move only on my mark.', emotion: 'stern', metadata: { cadence: 'urgent', pauseAfterMs: 220 } },
      { speaker: 'left', text: 'Mark. Move now.', emotion: 'angry', metadata: { cadence: 'staccato', transitionIntensity: 'high' } },
      { speaker: 'right', text: 'Moving.', metadata: { cadence: 'brief' } },
    ],
  },
  {
    id: 'colonel-hold-pattern',
    title: 'Holding Pattern',
    contactCharacterId: 'colonel',
    lines: [
      { speaker: 'left', text: 'Snake, hold your position. Do not break cover.', emotion: 'stern', metadata: { cadence: 'measured', transitionIntensity: 'medium' } },
      { speaker: 'right', text: 'How long?', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Until the upper deck sweep clears. I need a clean lane for you.', emotion: 'thinking', metadata: { cadence: 'measured' } },
      { speaker: 'right', text: 'I do not like waiting.', metadata: { cadence: 'brief', pauseAfterMs: 160 } },
      { speaker: 'left', text: 'Neither do I. But a patient operative survives.', emotion: 'stern', metadata: { cadence: 'measured' } },
      { speaker: 'left', text: 'Stand by... sweep is passing now.', metadata: { cadence: 'measured', pauseAfterMs: 320 } },
      { speaker: 'right', text: 'Copy. Holding.', metadata: { cadence: 'brief' } },
    ],
  },
  {
    id: 'otacon-sensor-spike',
    title: 'Sensor Spike Alert',
    contactCharacterId: 'otacon',
    lines: [
      { speaker: 'left', text: 'Snake, I just got a thermal spike on your floor.', emotion: 'surprised', metadata: { cadence: 'urgent', transitionIntensity: 'high' } },
      { speaker: 'right', text: 'False alarm?', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Maybe. It is moving like a maintenance cart, but too fast.', emotion: 'thinking', metadata: { cadence: 'measured' } },
      { speaker: 'right', text: 'So not a cart.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Yeah. Sorry. Probably a patrol drone with a bad regulator.', emotion: 'hurt', metadata: { cadence: 'staccato' } },
      { speaker: 'left', text: 'If it turns toward you, freeze and let it sweep past.', emotion: 'stern', metadata: { cadence: 'urgent', pauseAfterMs: 220 } },
      { speaker: 'right', text: 'That plan sounds familiar.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Because it keeps working.', emotion: 'thinking', metadata: { cadence: 'brief', pauseAfterMs: 260 } },
    ],
  },
  {
    id: 'otacon-systems-guidance',
    title: 'Systems Guidance',
    contactCharacterId: 'otacon',
    lines: [
      { speaker: 'left', text: 'Snake, your suppressor wear is climbing. I can help stretch it.', emotion: 'thinking', metadata: { cadence: 'measured', transitionIntensity: 'low' } },
      { speaker: 'right', text: 'Do it.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Fire in short pairs. Let the barrel cool between corners.', emotion: 'stern', metadata: { cadence: 'measured' } },
      { speaker: 'right', text: 'Anything else?', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Your radar refresh is desynced by half a second. I can compensate on my side.', metadata: { cadence: 'measured' } },
      { speaker: 'right', text: 'Keep me fed.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Right. Quiet steps, short bursts, and I will keep the numbers clean.', emotion: 'thinking', metadata: { cadence: 'measured', pauseAfterMs: 180 } },
    ],
  },
  {
    id: 'meryl-crossfire-warning',
    title: 'Crossfire Warning',
    contactCharacterId: 'meryl',
    lines: [
      { speaker: 'left', text: 'Snake, hold up. Two teams are crossing angles ahead of you.', emotion: 'angry', metadata: { cadence: 'urgent', transitionIntensity: 'high' } },
      { speaker: 'right', text: 'Distance?', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Fifteen meters and tightening. If you push now, you are in their overlap.', emotion: 'stern', metadata: { cadence: 'urgent' } },
      { speaker: 'right', text: 'Suggested lane.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Drop to the service trench on your right and crawl under the catwalk.', metadata: { cadence: 'measured' } },
      { speaker: 'right', text: 'Tight fit.', metadata: { cadence: 'brief', pauseAfterMs: 140 } },
      { speaker: 'left', text: 'You wanted stealth. Stealth is cramped.', metadata: { cadence: 'staccato' } },
      { speaker: 'right', text: 'Moving now.', metadata: { cadence: 'brief' } },
    ],
  },
  {
    id: 'meryl-timing-window',
    title: 'Timing Window',
    contactCharacterId: 'meryl',
    lines: [
      { speaker: 'left', text: 'Snake, I am opening you a window at the checkpoint.', emotion: 'stern', metadata: { cadence: 'urgent', transitionIntensity: 'medium' } },
      { speaker: 'right', text: 'Length.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Twelve seconds once the floodlight pivots off center.', metadata: { cadence: 'staccato' } },
      { speaker: 'right', text: 'That is not a window. That is a crack.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Then be a needle. Ready?', metadata: { cadence: 'urgent', pauseAfterMs: 120 } },
      { speaker: 'right', text: 'Ready.', metadata: { cadence: 'brief' } },
      { speaker: 'left', text: 'Three... two... one...', metadata: { cadence: 'staccato', pauseAfterMs: 360 } },
      { speaker: 'left', text: 'Go.', emotion: 'angry', metadata: { cadence: 'staccato', transitionIntensity: 'high' } },
      { speaker: 'right', text: 'Through.', metadata: { cadence: 'brief' } },
    ],
  },
];

export function getScriptedScenarios() {
  return SCRIPTED_SCENARIOS;
}

export function getScriptedScenariosForContact(contactCharacterId?: CodecCharacterId) {
  if (!contactCharacterId || contactCharacterId === 'snake') {
    return [] as ScriptedScenario[];
  }

  return SCRIPTED_SCENARIOS.filter((scenario) => scenario.contactCharacterId === contactCharacterId);
}

export function getScriptedScenarioById(scenarioId: string) {
  return SCRIPTED_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null;
}

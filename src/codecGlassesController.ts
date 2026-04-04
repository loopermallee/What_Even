export type CodecInput = 'UP' | 'DOWN' | 'TAP' | 'DOUBLE_TAP' | 'AT_TOP' | 'AT_BOTTOM';

export type CodecScreen = 'incoming' | 'active' | 'ended';

type IncomingChoice = 'answer' | 'ignore';

type DialogueStep = {
  speaker: string;
  text: string;
};

const SCRIPT: DialogueStep[] = [
  { speaker: 'OTACON', text: 'Snake, signal check. You are readable.' },
  { speaker: 'SNAKE', text: 'I hear you. Keep this line tight.' },
  { speaker: 'OTACON', text: 'Patrol shifted. Corridor west is open.' },
  { speaker: 'SNAKE', text: 'Copy. Moving now. Stay on codec.' },
];

export type CodecViewModel = {
  screen: CodecScreen;
  frequency: string;
  speaker: string;
  dialogue: string;
  status: string;
  frameAsset: 'frame-incoming' | 'frame-active' | 'frame-ended';
  portraitAsset: 'portrait-otacon' | 'portrait-snake';
};

export type CodecInputResult = {
  changed: boolean;
  requestClose: boolean;
};

export class CodecGlassesController {
  private screen: CodecScreen = 'incoming';
  private incomingChoice: IncomingChoice = 'answer';
  private activeIndex = 0;
  private readonly frequency = '140.85';

  getViewModel(): CodecViewModel {
    if (this.screen === 'incoming') {
      const choiceAnswer = this.incomingChoice === 'answer' ? '> ANSWER' : '  ANSWER';
      const choiceIgnore = this.incomingChoice === 'ignore' ? '> IGNORE' : '  IGNORE';

      return {
        screen: 'incoming',
        frequency: this.frequency,
        speaker: 'OTACON',
        dialogue: this.wrapText(
          ['INCOMING CODEC', `FREQ ${this.frequency}`, 'OTACON LINK REQUEST'].join('\n'),
          26,
          4
        ),
        status: this.wrapText(
          [choiceAnswer, choiceIgnore, 'TAP=SELECT  DTAP=CLOSE'].join('\n'),
          30,
          4
        ),
        frameAsset: 'frame-incoming',
        portraitAsset: 'portrait-otacon',
      };
    }

    if (this.screen === 'active') {
      const step = SCRIPT[this.activeIndex] ?? SCRIPT[0];
      return {
        screen: 'active',
        frequency: this.frequency,
        speaker: step.speaker,
        dialogue: this.wrapText(
          [`${step.speaker}`, `${step.text}`].join('\n'),
          27,
          4
        ),
        status: this.wrapText(
          [`FREQ ${this.frequency}  LINKED`, 'TAP=NEXT  DTAP=END'].join('\n'),
          30,
          4
        ),
        frameAsset: 'frame-active',
        portraitAsset: step.speaker === 'SNAKE' ? 'portrait-snake' : 'portrait-otacon',
      };
    }

    return {
      screen: 'ended',
      frequency: this.frequency,
      speaker: 'SYSTEM',
      dialogue: this.wrapText(
        ['CONNECTION LOST', `${this.frequency} CLOSED`].join('\n'),
        26,
        4
      ),
      status: this.wrapText(
        ['TAP=RESET  DTAP=CLOSE'].join('\n'),
        30,
        4
      ),
      frameAsset: 'frame-ended',
      portraitAsset: 'portrait-otacon',
    };
  }

  handleInput(input: CodecInput): CodecInputResult {
    if (input === 'AT_TOP' || input === 'AT_BOTTOM') {
      return { changed: false, requestClose: false };
    }

    if (this.screen === 'incoming') {
      if (input === 'UP' || input === 'DOWN') {
        this.incomingChoice = this.incomingChoice === 'answer' ? 'ignore' : 'answer';
        return { changed: true, requestClose: false };
      }

      if (input === 'TAP') {
        if (this.incomingChoice === 'answer') {
          this.screen = 'active';
          this.activeIndex = 0;
        } else {
          this.screen = 'ended';
        }
        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        return { changed: false, requestClose: true };
      }
    }

    if (this.screen === 'active') {
      if (input === 'TAP') {
        if (this.activeIndex < SCRIPT.length - 1) {
          this.activeIndex += 1;
        } else {
          this.screen = 'ended';
        }
        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        this.screen = 'ended';
        return { changed: true, requestClose: false };
      }
    }

    if (this.screen === 'ended') {
      if (input === 'TAP') {
        this.screen = 'incoming';
        this.incomingChoice = 'answer';
        this.activeIndex = 0;
        return { changed: true, requestClose: false };
      }

      if (input === 'DOUBLE_TAP') {
        return { changed: false, requestClose: true };
      }
    }

    return { changed: false, requestClose: false };
  }

  private wrapText(content: string, maxCharsPerLine: number, maxLines: number) {
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
}

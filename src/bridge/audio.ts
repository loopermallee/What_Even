export type AudioTurnState = 'idle' | 'listening' | 'processing' | 'speaking';

export type AudioScaffold = {
  turnState: AudioTurnState;
  micEnabled: boolean;
};

export function createAudioScaffold(): AudioScaffold {
  return {
    turnState: 'idle',
    micEnabled: false,
  };
}

// TODO(phase-2): Wire microphone capture.
// TODO(phase-2): Add STT streaming and partial transcript updates.
// TODO(phase-2): Drive listening <-> active transitions from turn-taking state.

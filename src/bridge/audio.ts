import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';

export type AudioCaptureStatus = 'idle' | 'opening' | 'listening' | 'closing' | 'error';

type BridgeLike = {
  audioControl: (isOpen: boolean) => Promise<boolean>;
};

type BufferedChunk = {
  byteLength: number;
  durationMs: number;
  receivedAt: number;
};

export type AudioCaptureMetrics = {
  audioFrameCount: number;
  audioBufferByteLength: number;
  bufferedAudioDurationMs: number;
  lastAudioFrameAt: number;
  listeningActivityLevel: number;
};

type MicOperationResult = {
  ok: boolean;
  status: AudioCaptureStatus;
  micOpen: boolean;
  error: string | null;
};

function readDurationMsFromEventJson(event: EvenHubEvent) {
  const jsonData = event.jsonData;
  if (!jsonData || typeof jsonData !== 'object') {
    return null;
  }

  const data = jsonData as Record<string, unknown>;
  const candidates = [
    data.durationMs,
    data.duration_ms,
    data.chunkDurationMs,
    data.chunk_duration_ms,
    data.frameDurationMs,
    data.frame_duration_ms,
    data.dtMs,
    data.dt_ms,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  const micros = [data.durationUs, data.duration_us, data.dtUs, data.dt_us];
  for (const value of micros) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value / 1000;
    }
  }

  return null;
}

function getActivityLevel(audioPcm: Uint8Array) {
  if (audioPcm.length < 2) {
    return 0;
  }

  let sumSquares = 0;
  let sampleCount = 0;
  for (let i = 0; i + 1 < audioPcm.length; i += 2) {
    let sample = audioPcm[i] | (audioPcm[i + 1] << 8);
    if (sample & 0x8000) {
      sample -= 0x10000;
    }

    const normalized = sample / 32768;
    sumSquares += normalized * normalized;
    sampleCount += 1;
  }

  if (sampleCount === 0) {
    return 0;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  return Math.max(0, Math.min(1, rms * 2.2));
}

export class AudioCaptureController {
  private readonly maxBufferDurationMs: number;
  private readonly chunks: BufferedChunk[] = [];
  private totalBufferedDurationMs = 0;
  private totalBufferedBytes = 0;
  private lastAudioFrameAt: number | null = null;
  private micOpen = false;
  private operationChain: Promise<MicOperationResult> = Promise.resolve({
    ok: true,
    status: 'idle',
    micOpen: false,
    error: null,
  });

  constructor(options?: { maxBufferDurationMs?: number }) {
    this.maxBufferDurationMs = options?.maxBufferDurationMs ?? 10_000;
  }

  isMicOpen() {
    return this.micOpen;
  }

  clearBuffer() {
    this.chunks.length = 0;
    this.totalBufferedDurationMs = 0;
    this.totalBufferedBytes = 0;
    this.lastAudioFrameAt = null;
  }

  requestMicOpen(bridge: BridgeLike) {
    this.operationChain = this.operationChain.then(async () => {
      if (this.micOpen) {
        return { ok: true, status: 'listening', micOpen: true, error: null };
      }

      try {
        const ok = Boolean(await bridge.audioControl(true));
        this.micOpen = ok;
        if (!ok) {
          return { ok: false, status: 'error', micOpen: false, error: 'audioControl(true) returned false' };
        }

        return { ok: true, status: 'listening', micOpen: true, error: null };
      } catch (error) {
        this.micOpen = false;
        return { ok: false, status: 'error', micOpen: false, error: String(error) };
      }
    });

    return this.operationChain;
  }

  requestMicClose(bridge: BridgeLike) {
    this.operationChain = this.operationChain.then(async () => {
      if (!this.micOpen) {
        return { ok: true, status: 'idle', micOpen: false, error: null };
      }

      try {
        const ok = Boolean(await bridge.audioControl(false));
        this.micOpen = false;
        if (!ok) {
          return { ok: false, status: 'error', micOpen: false, error: 'audioControl(false) returned false' };
        }

        return { ok: true, status: 'idle', micOpen: false, error: null };
      } catch (error) {
        this.micOpen = false;
        return { ok: false, status: 'error', micOpen: false, error: String(error) };
      }
    });

    return this.operationChain;
  }

  ingestAudioEvent(event: EvenHubEvent) {
    if (!event.audioEvent?.audioPcm) {
      return null;
    }

    const pcm = event.audioEvent.audioPcm;
    const now = Date.now();
    const metadataDurationMs = readDurationMsFromEventJson(event);
    const fallbackDurationMs = this.lastAudioFrameAt !== null ? Math.max(1, now - this.lastAudioFrameAt) : 1;
    const durationMs = metadataDurationMs ?? fallbackDurationMs;

    this.lastAudioFrameAt = now;
    this.chunks.push({
      byteLength: pcm.byteLength,
      durationMs,
      receivedAt: now,
    });

    this.totalBufferedBytes += pcm.byteLength;
    this.totalBufferedDurationMs += durationMs;

    while (this.totalBufferedDurationMs > this.maxBufferDurationMs && this.chunks.length > 0) {
      const removed = this.chunks.shift();
      if (!removed) {
        break;
      }

      this.totalBufferedBytes -= removed.byteLength;
      this.totalBufferedDurationMs -= removed.durationMs;
    }

    if (this.totalBufferedBytes < 0) {
      this.totalBufferedBytes = 0;
    }

    if (this.totalBufferedDurationMs < 0) {
      this.totalBufferedDurationMs = 0;
    }

    return {
      audioFrameCount: this.chunks.length,
      audioBufferByteLength: this.totalBufferedBytes,
      bufferedAudioDurationMs: Math.round(this.totalBufferedDurationMs),
      lastAudioFrameAt: now,
      listeningActivityLevel: getActivityLevel(pcm),
    } satisfies AudioCaptureMetrics;
  }
}

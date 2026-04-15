import type { SttStatus } from '../app/types';

export type StreamingSttSession = {
  start(): Promise<void>;
  sendAudio(chunk: Uint8Array): Promise<void>;
  stop(): Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onError(cb: (error: string) => void): void;
  onStateChange(cb: (state: SttStatus) => void): void;
};

type CallbackBundle = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStateChange: (state: SttStatus) => void;
};

function normalizeDeepgramTranscriptPayload(payload: unknown): { text: string; isFinal: boolean } | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.type !== 'Results') {
    return null;
  }

  const channel = record.channel;
  if (!channel || typeof channel !== 'object') {
    return null;
  }

  const alternatives = (channel as Record<string, unknown>).alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return null;
  }

  const top = alternatives[0];
  if (!top || typeof top !== 'object') {
    return null;
  }

  const text = String((top as Record<string, unknown>).transcript ?? '').trim();
  if (!text) {
    return null;
  }

  return {
    text,
    isFinal: Boolean(record.is_final),
  };
}

function normalizeDeepgramErrorPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const type = String(record.type ?? '').trim().toLowerCase();
  const candidates = [record.description, record.error, record.err_msg, record.message];
  const detail = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!detail) {
    return null;
  }

  const normalizedDetail = String(detail).trim();
  if (!normalizedDetail) {
    return null;
  }

  if (type === 'error' || type === 'warning' || type === 'close') {
    return normalizedDetail;
  }

  if ('error' in record || 'err_msg' in record) {
    return normalizedDetail;
  }

  return null;
}

function describeCloseEvent(event: CloseEvent) {
  const reason = event.reason ? `, reason=${event.reason}` : '';
  return `code=${event.code}, clean=${event.wasClean ? 'yes' : 'no'}${reason}`;
}

function looksLikeJwt(accessToken: string) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken);
}

function buildDeepgramWebSocketProtocols(accessToken: string) {
  const authScheme = looksLikeJwt(accessToken) ? 'bearer' : 'token';
  return [authScheme, accessToken];
}

export class DeepgramStreamingSttSession implements StreamingSttSession {
  private readonly accessToken: string;
  private readonly wsUrl: string;
  private readonly model: string;
  private ws: WebSocket | null = null;
  private callbacks: CallbackBundle = {
    onPartial: () => undefined,
    onFinal: () => undefined,
    onError: () => undefined,
    onStateChange: () => undefined,
  };

  constructor(options: { accessToken: string; wsUrl?: string; model?: string }) {
    this.accessToken = options.accessToken;
    this.wsUrl = options.wsUrl ?? 'wss://api.deepgram.com/v1/listen';
    this.model = options.model ?? 'nova-3';
  }

  onPartial(cb: (text: string) => void) {
    this.callbacks.onPartial = cb;
  }

  onFinal(cb: (text: string) => void) {
    this.callbacks.onFinal = cb;
  }

  onError(cb: (error: string) => void) {
    this.callbacks.onError = cb;
  }

  onStateChange(cb: (state: SttStatus) => void) {
    this.callbacks.onStateChange = cb;
  }

  async start() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.callbacks.onStateChange('connecting');

    const url = new URL(this.wsUrl);
    url.searchParams.set('model', this.model);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', '16000');
    url.searchParams.set('channels', '1');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('endpointing', '300');

    // Deepgram documents browser-side /v1/listen auth via Sec-WebSocket-Protocol
    // when custom Authorization headers are unavailable.
    this.ws = new WebSocket(url.toString(), buildDeepgramWebSocketProtocols(this.accessToken));
    this.ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('stt websocket missing'));
        return;
      }

      const ws = this.ws;
      let settled = false;

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      const resolveOnce = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      ws.onopen = () => {
        this.callbacks.onStateChange('streaming');
        resolveOnce();
      };

      ws.onerror = () => {
        if (settled) {
          this.callbacks.onStateChange('error');
          this.callbacks.onError('Deepgram websocket error');
          return;
        }
      };

      ws.onclose = (event) => {
        this.ws = null;
        if (settled) {
          return;
        }

        const detail = describeCloseEvent(event);
        const message = `Deepgram websocket closed before open (${detail})`;
        this.callbacks.onStateChange('error');
        this.callbacks.onError(message);
        rejectOnce(new Error(message));
      };

      ws.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }

        const providerError = normalizeDeepgramErrorPayload(parsed);
        if (providerError) {
          const message = `Deepgram provider error: ${providerError}`;
          this.callbacks.onStateChange('error');
          this.callbacks.onError(message);
          rejectOnce(new Error(message));
          return;
        }

        const transcript = normalizeDeepgramTranscriptPayload(parsed);
        if (!transcript) {
          return;
        }

        if (transcript.isFinal) {
          this.callbacks.onFinal(transcript.text);
          return;
        }

        this.callbacks.onPartial(transcript.text);
      };
    });
  }

  async sendAudio(chunk: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(chunk);
  }

  async stop() {
    if (!this.ws) {
      this.callbacks.onStateChange('idle');
      return;
    }

    this.callbacks.onStateChange('closing');
    await new Promise<void>((resolve) => {
      if (!this.ws) {
        resolve();
        return;
      }

      const ws = this.ws;
      ws.onclose = () => {
        this.ws = null;
        this.callbacks.onStateChange('idle');
        resolve();
      };

      ws.close(1000, 'listening-stopped');
    });
  }
}

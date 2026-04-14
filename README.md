# What Even

G2-first codec app with companion web UI.

## Phase 5A STT Security Baseline

Streaming STT now uses a backend Deepgram token broker. The browser no longer relies on a long-lived Deepgram key for normal operation.

### Required setup

Server-only required:

```bash
DEEPGRAM_API_KEY=your_deepgram_key
```

Client optional override (only if deployment cannot use same-origin broker path):

```bash
# Optional deployment override
VITE_STT_BROKER_URL=https://your-broker.example.com/api/stt/auth
```

Default behavior (recommended):

- Frontend uses same-origin `POST /api/stt/auth`.
- In local Vite dev, `/api/stt/auth` is proxied to `http://localhost:8787` by default.

### Run locally

Terminal 1 (broker):

```bash
npm run broker
```

Terminal 2 (web app):

```bash
npm run dev
```

### Broker security behavior

- `Cache-Control: no-store` on auth responses.
- `Content-Type: application/json; charset=utf-8` on success and failure responses.
- Same-origin allowed by default.
- Cross-origin allowed only when `STT_BROKER_CORS_ALLOWLIST` explicitly includes the origin.
- Simple in-memory rate limiting via:
  - `STT_BROKER_RATE_LIMIT_WINDOW_MS`
  - `STT_BROKER_RATE_LIMIT_MAX`
- Upstream timeout enforced via `STT_BROKER_TIMEOUT_MS`.

### Optional broker env vars

```bash
STT_BROKER_PORT=8787
STT_BROKER_TIMEOUT_MS=5000
STT_BROKER_RATE_LIMIT_WINDOW_MS=60000
STT_BROKER_RATE_LIMIT_MAX=30
DEEPGRAM_TOKEN_TTL_SECONDS=60
STT_BROKER_CORS_ALLOWLIST=https://your-web-origin.example.com
```

### Deprecated

- `VITE_DEEPGRAM_API_KEY` is deprecated/removed from the normal runtime path.

# What Even

G2-first codec app with companion web UI.

## Phase 5B Lifecycle Race + Release Readiness

Phase 5B adds a lightweight DEV-only lifecycle race harness and release validation docs.

- In DEV mode, use the `Lifecycle Race Harness` panel in the web UI:
  - Run single scenarios or `Run All (Isolated)`.
  - Every scenario starts from baseline and reports `cleanupRecovered: true|false`.
  - `blocked` is reserved for baseline reset failures or timeout cleanup invariant failures.
- Release docs:
  - `docs/release-readiness-checklist.md`
  - `docs/smoke-test-matrix.md`
  - `docs/operational-runbook.md`

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
- On Vercel, the same `/api/stt/auth` path is served by the serverless function in `api/stt/auth.ts`, so production no longer needs `npm run broker`.

### Run locally

Terminal 1 (broker):

```bash
npm run broker
```

Terminal 2 (web app):

```bash
npm run dev
```

### Run on Vercel

- Keep the frontend on same-origin `POST /api/stt/auth`.
- Add `DEEPGRAM_API_KEY` to the Vercel project's environment variables.
- Optional broker env vars below can also be set in Vercel if you want non-default timeout, TTL, rate limit, or cross-origin allowlist behavior.
- No separate production broker process is required.

### Broker security behavior

- `Cache-Control: no-store` on auth responses.
- `Content-Type: application/json; charset=utf-8` on success and failure responses.
- Same-origin allowed by default.
- Cross-origin allowed only when `STT_BROKER_CORS_ALLOWLIST` explicitly includes the origin.
- Simple in-memory rate limiting via:
  - `STT_BROKER_RATE_LIMIT_WINDOW_MS`
  - `STT_BROKER_RATE_LIMIT_MAX`
- Upstream timeout enforced via `STT_BROKER_TIMEOUT_MS`.
- Production implementation lives in [`api/stt/auth.ts`](api/stt/auth.ts); local broker remains available at [`server/sttBroker.mjs`](server/sttBroker.mjs).

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

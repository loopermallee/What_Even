# What Even

G2-first codec app with companion web UI.

## Phase 2B STT Config (Prototype/Dev Only)

Streaming STT is wired to Deepgram via browser WebSocket for Phase 2B prototyping.

Required env:

```bash
VITE_DEEPGRAM_API_KEY=your_deepgram_key
# Optional override (defaults to wss://api.deepgram.com/v1/listen)
VITE_DEEPGRAM_WS_URL=wss://api.deepgram.com/v1/listen
```

Important safety note:

- `VITE_DEEPGRAM_API_KEY` is a dev-only path and should not be treated as production-safe.
- For safer production-style deployments, use a backend token broker that issues short-lived/ephemeral credentials instead of exposing a long-lived provider key in browser code.


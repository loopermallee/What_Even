# Operational Runbook (Phase 5B)

## Required env vars
- Broker required: `DEEPGRAM_API_KEY`
- Client optional override: `VITE_STT_BROKER_URL` (prefer default same-origin path)
- Local proxy optional: `VITE_BROKER_PROXY_TARGET`
- Deprecated path must remain unused: `VITE_DEEPGRAM_API_KEY`

## Startup order
1. Start broker: `npm run broker`
2. Start app: `npm run dev`
3. In app, run `Start on Even` and verify startup lifecycle completes.

## Verify broker path is used
- Check browser requests are hitting `POST /api/stt/auth`.
- Confirm broker logs show `auth_request_*` events.
- Confirm no client-side direct Deepgram key auth path is active.

## Verify no deprecated client-key fallback
- Ensure `VITE_DEEPGRAM_API_KEY` is unset.
- Force broker failure and confirm app fails closed (no speech session starts from client secret fallback).

## First checks when STT fails
1. Confirm broker process is running and healthy.
2. Confirm `DEEPGRAM_API_KEY` is present and valid.
3. Inspect broker status/error responses for `category/code`.
4. Inspect app diagnostics (`sttStatus`, `sttError`, retry fields).
5. Run harness stale/retry scenarios and verify cleanup recovery.

## First checks when lifecycle state gets stuck
1. Inspect current `screen`, `micOpen`, `audioCaptureStatus`, `sttStatus`.
2. Inspect reliability fields:
- active STT session/token
- retry scheduled/cancelled timestamps
- last ignored stale callback
- last cleanup reason/time
3. Run a single harness scenario, then `Run All` to confirm isolation and cleanup recovery.
4. If `blocked` appears, treat as release blocker until baseline/cleanup invariants recover.

## Stop-ship triggers
- Broker auth intermittently failing in smoke runs.
- STT retry revives dead sessions after exit.
- Mic/STT stuck open or streaming after cleanup boundaries.
- Transcript mutates after listening exit.
- Stale callbacks mutate active session state.
- Logs expose sensitive data.

## Rollback triggers after release
- Reproducible auth path instability causing user-visible STT startup failure.
- Lifecycle wedging that requires app restart to recover.
- Post-exit transcript/state corruption from stale callbacks.
- Sensitive-data logging regression.

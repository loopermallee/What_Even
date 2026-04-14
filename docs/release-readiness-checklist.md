# Release Readiness Checklist (Phase 5B)

Use this checklist before shipping.

## Config readiness
- [ ] `DEEPGRAM_API_KEY` is set for the broker runtime.
- [ ] `VITE_STT_BROKER_URL` is unset (same-origin default) or points to the intended broker endpoint.
- [ ] `VITE_DEEPGRAM_API_KEY` is not used in runtime config.

## Broker readiness
- [ ] `npm run broker` starts without config errors.
- [ ] `POST /api/stt/auth` returns JSON with `ok: true` and `accessToken`.
- [ ] Broker logs do not leak token/key/secret material.

## STT startup check
- [ ] From `listening`, STT transitions through `connecting` and `streaming` when bridge audio is active.
- [ ] On broker/auth failure, app remains fail-closed (`sttStatus=error`, no insecure fallback).

## Lifecycle race checks
- [ ] Run all lifecycle race harness scenarios in DEV.
- [ ] Every scenario has an explicit `cleanupRecovered: true|false` result.
- [ ] No scenario is `blocked` unless baseline reset or timeout cleanup invariants fail.

## Stale callback checks
- [ ] No transcript mutation after listening exit in stale callback scenarios.
- [ ] Stale callback diagnostics do not revive dead sessions.

## Transcript / turn-taking checks
- [ ] Transcript roles remain `user | contact | system` only.
- [ ] `Active Next` behavior is unchanged.
- [ ] Deterministic turn-taking behavior is unchanged.

## Error-state checks
- [ ] Repeated End/Continue taps do not wedge screen or turn state.
- [ ] Mic/STT are not stuck open after end/cleanup boundaries.
- [ ] Retry scheduling is cleared on exit boundaries.

## Logging / redaction checks
- [ ] Logs remain actionable for lifecycle + auth failures.
- [ ] No secret-bearing payloads appear in browser or broker logs.

## Device validation
- [ ] Simulator smoke checks pass.
- [ ] Real G2 smoke checks pass for startup, listening, active, and cleanup boundaries.

## Stop-ship / rollback gates
- [ ] No blocker symptom from `docs/smoke-test-matrix.md` or `docs/operational-runbook.md` remains unresolved.

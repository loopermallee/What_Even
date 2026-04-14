# Smoke Test Matrix

## Local browser + broker

| Test | Pass signal | Failure signal | Required |
|---|---|---|---|
| Broker auth endpoint | `POST /api/stt/auth` returns `ok: true` JSON | 4xx/5xx, invalid JSON, missing token | Yes |
| Lifecycle race harness (`Run All`) | Scenarios complete with expected statuses; no unexpected `blocked`; cleanup reported every run | Baseline reset fails, timeout cleanup fails, wedged state | Yes |
| Core transitions | `contacts->incoming->listening->active/ended->contacts` match expected flow | Any broken transition or unexpected screen hop | Yes |
| Transcript integrity | Roles and ordering remain valid; no post-exit mutation in stale scenarios | Transcript changes after cleanup/exit | Yes |

## Simulator

| Test | Pass signal | Failure signal | Required |
|---|---|---|---|
| Start on Even flow | Startup lifecycle completes and input listener is active | Startup rebuild fails or input not captured | Yes |
| Listening session | Enter listening and see expected mic/STT status progression | Mic/STT stuck idle/open/streaming incorrectly | Yes |
| Rapid lifecycle boundaries | End/Redial/Back boundaries settle to expected screens | State wedges or retries revive dead sessions | Yes |

## Real G2 device

| Test | Pass signal | Failure signal | Required |
|---|---|---|---|
| Broker-first startup | Device run works with broker auth path only | Auth intermittency or fallback-like behavior | Yes |
| STT real speech cycle | Confirmed speech enters transcript and transitions remain stable | STT never streams, transcript drops/duplicates unexpectedly | Yes |
| Exit cleanup under stress | After rapid End/Back/Redial, mic/STT return to safe idle and app remains responsive | Mic/STT stuck, stale callbacks alter current session | Yes |

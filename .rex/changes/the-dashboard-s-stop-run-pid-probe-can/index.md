---
id: "da2587c4-6df6-47fb-ba34-3f24ac9fab8b"
type: "change"
title: "The dashboard's stop-run pid probe can signal the wrong Windows process"
slug: "the-dashboard-s-stop-run-pid-probe-can"
intent: "packages/web/src/server/routes-hench.ts `pidAlive` (~3530, used by stopRecordedRunProcess) lacks the `win32 && pid % 4 !== 0` guard that run-staleness.ts `isPidAlive` has. Windows ignores a pid's low two bits, so for a fresh malformed run record naming pid 4242 while process 4240 exists, pidAlive(4242) can be true and the SIGTERM/SIGKILL escalation can hit process 4240.\n\nReachable: only when stopping a run from a fresh malformed record on Windows: its pid must be a positive integer other than the dashboard process pid, its lastActivityAt must pass isRunStale, and its host must match hostname() or be absent. A stale record is rejected before signaling, and an explicitly foreign-host record is also rejected. A record written on another OS is therefore not sufficient by itself.\n\nFix options: (1, recommended) use run-staleness' isPidAlive (or add the same guard); small. Note run-staleness treats EPERM as alive — check that is right for the stop path.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own.\n\nReview qualification (2026-11-16): stopRecordedRunProcess already checks heartbeat freshness and host before pidAlive and signalPid. The missing Windows PID-shape guard remains pre-existing, but the original stale-record example overstated its reachability. This correction narrows the scenario; it does not change code, priority or acceptance criteria."
acceptanceCriteria:
  - "On Windows, the stop-run path never signals a pid that is not a multiple of 4"
  - "A test with a non-multiple-of-4 pid asserts no signal is sent"
touches:
  - "3bc1cab2-ebb4-4f6a-8d4f-a19e3fb22a09"
priority: "high"
source: "ndx-adversarial-review"
---

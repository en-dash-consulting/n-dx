---
id: "da2587c4-6df6-47fb-ba34-3f24ac9fab8b"
type: "change"
title: "The dashboard's stop-run pid probe can signal the wrong Windows process"
slug: "the-dashboard-s-stop-run-pid-probe-can"
intent: "packages/web/src/server/routes-hench.ts `pidAlive` (~3530, used by stopRecordedRunProcess) lacks the `win32 && pid % 4 !== 0` guard that run-staleness.ts `isPidAlive` has. Windows ignores a pid's low two bits, so for a stale run record naming pid 4242 while process 4240 exists, pidAlive(4242) is true and the SIGTERM/SIGKILL escalation hits process 4240.\n\nReachable: yes, stopping a run from the dashboard on Windows when the recorded pid is not a multiple of 4 (e.g. a record written on another OS or corrupted).\n\nFix options: (1, recommended) use run-staleness' isPidAlive (or add the same guard); small. Note run-staleness treats EPERM as alive — check that is right for the stop path.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "On Windows, the stop-run path never signals a pid that is not a multiple of 4"
  - "A test with a non-multiple-of-4 pid asserts no signal is sent"
priority: "high"
source: "ndx-adversarial-review"
---

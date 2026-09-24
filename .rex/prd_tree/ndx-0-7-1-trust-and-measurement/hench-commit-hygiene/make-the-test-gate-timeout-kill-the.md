---
id: "4b45c028-0bb4-47e8-a4b0-f795e524221b"
level: "task"
title: "Make the test-gate timeout kill the whole test process tree"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "pr-c2"
  - "hench"
  - "test-gate"
  - "process-lifecycle"
source: "PR M execution, 2026-09-24 (run 8dc53406)"
acceptanceCriteria:
  - "A gate test command that spawns long-running grandchildren is fully terminated within a few seconds of the timeout, on macOS and Linux."
  - "The reported duration of a timed-out gate is at most the timeout plus a small grace period."
  - "Windows behaviour is covered or explicitly documented as best-effort."
description: "Run 8dc53406's gate reported \"`npm run test` did not finish within 15m 0s and was killed (ran for 21m 45s)\". Killing at 15 minutes did not end the suite for almost seven more minutes, which suggests the kill reaches `npm` but not its `node scripts/run-all-tests.mjs` and vitest children. The machine was also heavily loaded (load averages about 10.9 and 9.6), which is what took a roughly 6-minute suite past 15 minutes. The load-induced `cli-hints` failure in that run is tracked separately (dc6224ba). Kill the process group, or tree, on timeout, as other hench spawns do (see `hidden-detached-spawns.md`), and make the timeout message report when the kill took effect."
lastModified: "2026-09-24T20:30:32.834Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

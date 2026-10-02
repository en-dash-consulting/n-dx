---
id: "39a4eac9-732d-4733-9afc-36bfc7462abc"
level: "task"
title: "Make the vendorPid spawn tests pass on Windows, where the recorded pid is the cmd.exe wrapper's"
status: "completed"
priority: "high"
tags:
  - "live"
  - "ci"
  - "windows"
source: "CI CLI Smoke (Windows) on PR #496, 2026-10-01"
startedAt: "2026-10-02T01:22:51.097Z"
completedAt: "2026-10-02T01:29:10.948Z"
endedAt: "2026-10-02T01:29:10.948Z"
acceptanceCriteria:
  - "Both pid tests pass on Windows and still assert exact pid equality on macOS and Linux."
  - "On win32 the tests assert vendorPid is set and alive while the child runs, and cleared after close."
  - "The vendorPid docs on the run record and on LiveSpawnProgress say that on Windows it is the cmd.exe wrapper's pid."
  - "Changeset for @n-dx/hench (patch)."
description: "CI's CLI Smoke (Windows) job fails two tests in `packages/hench/tests/integration/livelock-cli-spawn.test.ts`: \"exposes the child's pid while it runs and clears it once it closes\" (expected 4312 to be 3524) and \"records the pid in a pid-only holder without touching run counters (review, orientation)\" (expected 1244 to be 1688); run 36937586523 on PR #496. Both compare the recorded `vendorPid` with the pid the child writes about itself (`HENCH_TEST_CHILD_PID`). On win32, `spawnCli` (called from `spawnWithAdapter` in `packages/hench/src/agent/lifecycle/cli-loop.ts`) launches the command through cmd.exe (GH #37/#68/#69), so `proc.pid` — what `vendorPid` records — is the wrapper's pid, not the child's. That is acceptable for liveness: the wrapper lives exactly as long as the CLI. Fix the tests, not the spawn: on win32 assert that `vendorPid` is a positive integer whose process is alive (`process.kill(pid, 0)`) while the child runs and that it is cleared after close; keep the exact equality with the child's self-reported pid on POSIX. Add one sentence to the `vendorPid` doc on the run record schema (`packages/hench/src/schema/v1.ts`) and on `LiveSpawnProgress.vendorPid` saying that on Windows it is the cmd.exe wrapper's pid. Run git commands bare from the project root (no `cd …&&`, no `git -C`)."
lastModified: "2026-10-02T01:29:11.334Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

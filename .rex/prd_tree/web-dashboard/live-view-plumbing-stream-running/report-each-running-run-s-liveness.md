---
id: "02c5b44e-a84a-4c77-b40c-10febaf2069c"
level: "task"
title: "Report each running run's liveness verdict in /api/live and runs/health across every worktree, pinned to hench's rules by a parity test"
status: "pending"
priority: "high"
tags:
  - "live"
  - "run-liveness"
  - "adopted-from-pr-484"
blockedBy:
  - "fb20ed48-0a1e-4c82-b556-a5a7a1dc8d9d"
source: "adopted from draft PR #484 (fix/running-task-audit), adapted to the Live branch's decisions, 2026-10-01"
acceptanceCriteria:
  - "/api/live and GET /api/hench/runs/health return liveness, livenessReason and canEnd for running runs in every worktree of the repository (integration test with two worktrees)."
  - "A parity test feeds the same fixtures to the hench and web verdict functions and requires identical output."
  - "There is one isPidAlive in the web server, with EPERM counted as alive."
  - "Existing stale, pid, vendorPid and pidAlive fields are unchanged."
description: "Mirror the hench liveness verdict (previous task) in the web server, because web takes no runtime dependency on hench: `packages/web/src/server/run-liveness.ts`, kept identical by an e2e parity test like #484's `tests/e2e/run-liveness-parity.test.js` (`git show refs/review/pr-484:tests/e2e/run-liveness-parity.test.js`). Use the shared `isPidAlive` in `run-staleness.ts` (EPERM alive) rather than adding another copy; `routes-hench.ts` also has a private `isPidAlive` — consolidate it onto the shared one.\n\nUnlike #484, judge every worktree of the repository, not only the served one: for each worktree the live endpoint already lists, read that worktree's run records and its `.hench/locks/` (through the layout resolver, not a hard-coded `.hench`). Add `liveness`, `livenessReason` and `canEnd` to each run in `GET /api/live` and in `GET /api/hench/runs/health`, keep `stale`, `pid`, `vendorPid` and `pidAlive` as they are, and add a per-verdict summary. A run the dashboard spawned and still holds as a child process is `live` (#484's managed-child rule). When this branch next merges main, #484's conflicting edit to the health endpoint is not taken; this task supersedes it."
lastModified: "2026-10-01T19:44:41.416Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

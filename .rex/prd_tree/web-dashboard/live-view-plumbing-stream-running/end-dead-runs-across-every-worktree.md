---
id: "0803271f-012a-4d7d-8abe-8488cbf8641d"
level: "task"
title: "End dead runs across every worktree from one reconcile route, with one terminal status shared with Mark stuck"
status: "completed"
priority: "high"
tags:
  - "live"
  - "run-liveness"
  - "adopted-from-pr-484"
blockedBy:
  - "02c5b44e-a84a-4c77-b40c-10febaf2069c"
source: "adopted from draft PR #484 (fix/running-task-audit), adapted to the Live branch's decisions, 2026-10-01"
startedAt: "2026-10-01T21:13:13.755Z"
completedAt: "2026-10-01T21:24:55.876Z"
endedAt: "2026-10-01T21:24:55.876Z"
resolutionType: "code-change"
resolutionDetail: "POST /api/hench/runs/reconcile across every worktree; shared terminal shape in run-end.ts used by Mark stuck too (commit 94378e326)."
acceptanceCriteria:
  - "POST /api/hench/runs/reconcile ends orphaned runs in every worktree and leaves live and foreign runs untouched (integration test with two worktrees)."
  - "dryRun changes nothing and reports what would end; runIds narrows to the named runs; unknown runs end only with includeUnknown."
  - "Mark stuck and reconcile write the same status and error prefix (test)."
  - "A run whose verdict changed to live after the dry run is not ended (test)."
  - "Changeset for @n-dx/web (patch)."
description: "Adapt #484's `POST /api/hench/runs/reconcile` (`git show refs/review/pr-484:packages/web/src/server/routes-hench.ts`, commit df68740c5): end every running run whose verdict is `orphaned`, never touch `live` or `foreign`, and touch `unknown` only when `includeUnknown` is set. Support `dryRun` (report what would end) and `runIds` (narrow to named runs). Unlike #484 it covers every worktree of the repository; each run is written in its own worktree's `.hench/runs/` with an atomic write, and the response groups results by worktree. It writes run records only, never a PRD.\n\nOne terminal shape for every surface: ending a run sets `status: \"failed\"`, `finishedAt`, and an `error` starting with a shared prefix (adopt #484's \"Ended by audit reconciliation: <reason>\"); Mark stuck uses the same prefix with its own reason, so the record says how it ended whichever surface did it. Re-check each run's verdict immediately before writing, so a run that came back to life between the dry run and the call is left alone."
lastModified: "2026-10-01T21:24:57.513Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

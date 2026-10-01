---
id: "94195450-f8a4-4798-857b-a63d71ec3482"
level: "task"
title: "Make the Live strip's agent slots match the repository-wide run list, using the hub's admission capacity when served through the hub"
status: "completed"
priority: "medium"
tags:
  - "live"
  - "local-testing"
source: "local testing of PR #496, 2026-10-01"
startedAt: "2026-10-01T23:04:44.070Z"
completedAt: "2026-10-01T23:16:44.592Z"
endedAt: "2026-10-01T23:16:44.592Z"
resolutionType: "code-change"
resolutionDetail: "machine.slots: standalone counts live-verdict runs across all worktrees vs hench limit; behind the hub, proxy sends X-Ndx-Hub-Admission (running/maxSessions/queued) on GET /api/live and the route overlays it. Tile label names scope."
acceptanceCriteria:
  - "With one live terminal-started run in another worktree and no dashboard executions, the slots tile shows 1 in use (integration test, standalone mode)."
  - "Behind the hub, the tile shows the hub's running sessions and maxSessions, and queued count when non-zero (test with an injected admission snapshot)."
  - "The tile's label states its scope."
  - "Changeset for @n-dx/web (patch)."
description: "The Live machine strip shows \"Agent slots 0 of 3\" while a run is live in another worktree, because `machine.slots` comes from `readConcurrencySlots(ctx)` (`packages/web/src/server/routes-live.ts` around line 584), the served worktree's own concurrency, while every other part of Live covers all worktrees of the repository. Terminal-started runs in other worktrees never count.\n\nWhen the server is behind the hub, report the hub's machine-wide admission state instead: running sessions and `maxSessions` from the `AdmissionGate` (`packages/web/src/hub/admission.ts`), plus queued count, exposed to project servers through the existing hub-to-project channel (do not import hub code into the project server; follow the injection-seam rule and register any new seam in `.claude/rules/web-injection-seams.md` — note agent runs cannot edit `.claude/`, so leave that row for the operator and say so). When the server runs standalone (`ndx start --here`), count runs whose liveness verdict is `live` across every worktree of the repository against the configured maximum. Label the tile with its scope (\"this machine\" behind the hub, \"this repository\" standalone) so the number can never silently disagree with the run list beside it."
lastModified: "2026-10-01T23:16:44.955Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

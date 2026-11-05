---
id: "5b73d052-964f-4145-ab5f-bf6c6b221f01"
type: "task"
title: "Workspaces health strip shows a 403 error on every worktree whose own .n-dx.json has git.branchHealth off"
slug: "workspaces-health-strip-shows-a-403"
description: "Verdict: should-fix (severity medium), found by the adversarial review of task 18f3e71f.\n\nScenario: the viewer reads `git.branchHealth` from its own workspace's `/api/features`, so the strip renders on every card. But each card's `GET /api/branch-health` goes out with `X-Ndx-Workspace`, and `enforceRouteFeatureGate` (packages/web/src/server/route-feature-gates.ts, called from start.ts handleApiRoutes) reads the toggle from that worktree's own `.n-dx.json`. `.n-dx.json` is tracked, so every worktree has its own copy.\n\nSo when the toggle is turned on from the anchor's Features page, every other worktree's card shows the red 403 text \"The feature \\\"git.branchHealth\\\" is turned off for this project…\" until that worktree's `.n-dx.json` also has the flag. That covers every branch worktree on the board, which is the main use of the strip. Entry point: the Workspaces view (packages/web/src/viewer/views/workspace-branch-health.ts, BranchHealthStrip error branch).\n\nOptions:\n(a) Render a `kind: \"feature_disabled\"` 403 as a quiet info chip, e.g. \"branch health is off in this worktree\". It's cheap and keeps the per-workspace gate semantics, but the user still has to enable the flag per worktree.\n(b) Make the board's cross-workspace read follow the viewer's toggle. This needs a decision on gate semantics, because the gate deliberately reads the addressed project (start.ts comment). It is riskier, because it creates a precedent for a cross-workspace gate exception.\n\nRecommendation: (a) now. Option (b) is the user's call."
acceptanceCriteria:
  - "A Workspaces card whose worktree answers /api/branch-health with a feature_disabled 403 shows a neutral note naming the worktree's own toggle, not a red error, covered by a viewer test that fails today"
  - "The behaviour when the anchor's toggle is on and a branch worktree's is off is documented in docs/architecture/web-server.md's Branch health section"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---

---
id: "bc0b4de5-ecb7-490f-b2a9-94ca4711b65a"
level: "task"
title: "Hub serves its project chooser at a fixed /hub path and answers /api/hub/* under a worktree slot"
status: "in_progress"
priority: "high"
tags:
  - "0.8.0"
  - "navigation-landings"
source: "ndx-capture"
startedAt: "2026-10-01T00:17:16.366Z"
acceptanceCriteria:
  - "GET /hub and /hub/ return the project chooser HTML whether 0, 1 or several projects are registered, while / still opens the sole project when only one is registered."
  - "/w/<key>/api/hub/* and /p/<id>/w/<key>/api/hub/* are answered by the hub itself, not proxied to the project server."
  - "The /hub path is defined once in src/shared/base-path.ts and used by both the hub and the viewer."
  - "tests/integration/hub-proxy.test.ts covers /hub with one and with two projects, and the hub API under a worktree slot."
description: "`/` is the hub's project chooser only while two or more projects are registered. With one, it opens that project's dashboard, so the dashboard has no stable link back to the hub. Separately, a branch worktree's dashboard sends `/p/<id>/w/<key>/api/hub/*` (and `/w/<key>/api/hub/*` on the single-project root alias) to the project server, which answers 404 — so the run-queue strip silently shows nothing on worktree pages."
lastModified: "2026-10-01T00:17:19.430Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

---
id: "33926ca8-40b7-43b8-a0de-45a3d1dc3490"
level: "task"
title: "/api/live shows a run whose process died as healthy for up to 5 minutes although pidAlive is known"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A running record whose pid is dead is reported with pidAlive false by /api/live (test)."
  - "The Live views show that the process is gone without changing the stuck count."
description: "Failure: `packages/web/src/server/routes-live.ts:429` classifies runs only by heartbeat age. When hench is SIGKILLed or OOM-killed the record stays running with a fresh `lastActivityAt`, so Live shows a healthy run until the 5-minute stale threshold, while `/api/hench/runs/health` already reports `pidAlive: false` for the same run. The opposite case (live pid, old heartbeat) is shown as stale, which matches the bottom bar.\n\nVerdict: should-fix (severity low).\n\nOptions:\n- Recommended: add `pidAlive` to each LiveRun and show \"process not found\" in the tab, peek and cards, leaving `stale` on the shared threshold so counts still agree with the bottom bar. Small."
lastModified: "2026-10-01T15:23:21.256Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

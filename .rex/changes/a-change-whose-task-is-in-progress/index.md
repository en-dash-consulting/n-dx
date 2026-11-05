---
id: "5f109594-0096-4a42-8b2a-a4b378aa43ce"
type: "change"
title: "A change whose task is in progress reads proposed, not in-progress"
slug: "a-change-whose-task-is-in-progress"
intent: "Out-of-scope finding from the adversarial review of 231adb0e (the Plan glance summary read). The defect is in pre-existing code, not that change.\n\nWhere: packages/web/src/server/routes-rex/product.ts `stageOf`. It reads only the change's own `startedAt` and `status`. When `ndx work` starts a task, rex records `status: in_progress` and `startedAt` on the task and leaves the change's own state empty.\n\nScenario (seen live, 2026-11-05): change f86e6895 \"Plan glance tiles…\" has no status or startedAt in `.rex/changes/plan-glance-tiles-lifecycle-strip/state.yaml`, while its task 231adb0e is `in_progress`. GET /api/rex/changes and GET /api/rex/changes/summary report the change as stage \"proposed\", and stages[\"in-progress\"] is 0 while hench is running on it. The Changes view, the Product overlays and Plan's lifecycle strip all show work in progress as not started.\n\nReachable: on every v2 project, whenever a task under a change is running and the change itself was never started. Verdict: out-of-scope (pre-existing stageOf), medium.\n\nOptions:\n(a) In stageOf, read in-progress when any live task or subtask under the change is in_progress, failing or started. Cheap, local to web. Risk: diverges from any stage rex later defines.\n(b) Have rex record startedAt on the change when its first task starts. This fixes the source, but touches rex's status transitions and every v2 write path.\nRecommend (a) now. stageOf's own comment says rex has no stage to defer to."
acceptanceCriteria:
  - "GET /api/rex/changes reports stage in-progress for an open change whose own state is empty while one of its tasks is in_progress (route test on the v2 fixture, failing on the current head)"
  - "GET /api/rex/changes/summary counts that change under stages[\"in-progress\"], not proposed (route test)"
  - "An open change with no started task and no ready flag still reads proposed (existing behaviour kept, route test)"
touches:
  - "e1a26302-7d80-46d4-9002-45e25119ba34"
priority: "medium"
discoveredFrom: {"item":"231adb0e-64e8-401c-91ed-c6ca8e30f5ad","run":"9092c024-764c-448c-a898-6a4329055420"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---

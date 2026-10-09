---
id: "73ad344b-2fcc-4d85-8606-820dc0606b9b"
level: "task"
title: "Cancelled or deleted items outside release epics and noun-shaped area features are still rules-placed"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T04:14:42.590Z"
completedAt: "2026-10-09T04:22:45.795Z"
endedAt: "2026-10-09T04:22:45.795Z"
acceptanceCriteria:
  - "A cancelled or deleted fix- or work-shaped feature under an area is an unapplied change with needsPlacement and no placement (test)"
  - "A cancelled task directly under an area, a cancelled PR-named epic, and a cancelled root-level item are held the same way (test)"
description: "Found by the adversarial review of task 75a39df3. Verdict: out-of-scope (pre-existing, not introduced by that change).\n\nAbandoned items are held, and never rules-placed, only in three places in packages/rex/src/migrations/v1-to-v2/migration-plan.ts:\n- abandoned epics with no release or PR token;\n- noun-shaped features under areas;\n- since 75a39df3, children of release epics.\n\nEvery other path still calls plan.change, which puts the item on the unplaced queue that place() rules-places:\n- an abandoned fix-shaped or work-shaped feature under an area (classifyUnderArea checks fix||work before isAbandoned);\n- a cancelled task directly under an area;\n- a cancelled epic named for a PR or issue;\n- a cancelled root-level task.\n\nScenario: under the area \"Storage\", a cancelled feature \"Fix offline cache\" sits beside the capability \"Offline cache\". The plan places it on that capability as an amends change instead of holding it for review.\n\nReachable via `ndx migrate --plan` on any v1 tree with cancelled work.\n\nRecommended fix: one branch inside PlanBuilder.change(). An abandoned item becomes applied:false, needsPlacement:true and skips the unplaced queue. That gives every path the same rule.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T04:22:46.697Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

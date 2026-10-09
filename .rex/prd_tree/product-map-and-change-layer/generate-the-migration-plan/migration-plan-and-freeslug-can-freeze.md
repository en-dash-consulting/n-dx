---
id: "eda7bfcb-1d92-419d-9882-79ac3eba99c4"
level: "task"
title: "Migration plan and freeSlug can freeze the slug \"index\", which the v2 writer refuses on a leaf"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T21:02:28.125Z"
completedAt: "2026-10-08T21:26:45.314Z"
endedAt: "2026-10-08T21:26:45.314Z"
acceptanceCriteria:
  - "buildPlanData assigns a non-\"index\" slug and flags a v1 subtask titled Index (test)"
  - "freeSlug never returns \"index\" in any case (test with titles Index and INDEX)"
  - "A migrated tree containing such a subtask is accepted by writePrdModel (test)"
description: "Found by the adversarial review of task b32a3e6f (Windows-unsafe slugs). Verdict: should-fix, medium.\n\nScenario: in v1, a subtask titled \"Index\" is a section inside its parent's index.md, so v1 is fine with it. In v2 that subtask is a leaf file, and its slug is \"index\". prd-model-writer.ts assertSlug refuses a leaf named \"index\" (\"no usable slug\"), and slugs are frozen, so the tree cannot be written. The new unsafe-slug check in migration-plan-data.ts (buildPlanData, using isWindowsSafeSegment) does not catch it, because \"index\" is Windows-safe. The same happens in core/apply-amendments.ts freeSlug: a new capability titled \"Index\" under an area gets slug \"index\". It also breaks later, when a folder node whose slug is \"index\" loses its last child and becomes a leaf.\n\nReachability: not reachable today, because the v2 writer is not wired to the store. It becomes reachable with the migration apply (PR 23) and v2 add.\n\nOptions: (a) recommended: one predicate, \"a frozen v2 slug is usable\", meaning Windows-safe and not \"index\" (case-insensitive). Use it in both freeSlug and buildPlanData's slug check, so the plan assigns \"index-<id6>\" and flags it. Cheap. (b) Allow \"index\" for folder nodes only. This keeps a slug that breaks as soon as the node becomes a leaf, so it is not recommended.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`: the affected test gate refuses a stale rex dist/ (run 699cd138 failed only on that)."
lastModified: "2026-10-08T21:26:45.581Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

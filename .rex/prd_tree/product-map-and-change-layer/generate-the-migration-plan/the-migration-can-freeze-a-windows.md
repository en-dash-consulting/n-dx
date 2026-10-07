---
id: "b32a3e6f-58a5-45e9-9f19-cb6f7891b5cc"
level: "task"
title: "The migration can freeze a Windows-unsafe v1 slug (con, aux, nul) into v2, leaving the tree permanently unwritable"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The migration plan flags each v1 item whose directory name fails isWindowsSafeSegment and assigns it a Windows-safe v2 slug (test with titles Con, AUX, Nul)"
  - "A migrated tree containing such items is accepted by writePrdModel (test)"
  - "v2 slug creation for new nodes never returns a slug that fails isWindowsSafeSegment (test)"
description: "Found by the adversarial review of task cbd9e418 (commit 7997db58d). Verdict: should-fix, medium.\n\nScenario: a v1 item titled \"Con\" or \"Aux\" gets the v1 slug `con`/`aux`. `slugifyTitle` is unchanged on purpose, and a Linux or macOS checkout can create these names. If the migration freezes v1 directory names as v2 `slug`s, the v2 writer (`packages/rex/src/store/prd-model-writer.ts` assertSlug → `isWindowsSafeSegment`) refuses every write to that tree. Slugs are frozen, and nothing can rename them yet. The same holds for any v2 tree created off Windows with such a slug, if v2 add/create does not check.\n\nReachability: not reachable today, because the v2 writer is not wired to the store. It becomes reachable when the migration (PR 13) and v2 add land. No current plan item mentions slug safety.\n\nOptions:\n(a) The migration plan checks every frozen slug with `isWindowsSafeSegment` (exported from `store/index.ts`) and assigns a safe replacement, e.g. a `-<id6>` suffix, recording the old path as an alias. Cheap, and the recommended option.\n(b) Also make v2 slug creation (add/create) produce only safe slugs.\n(c) A rename-slug escape hatch for trees already written. More cost, and it breaks the frozen-slug guarantee."
lastModified: "2026-10-07T20:29:07.007Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

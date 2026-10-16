---
id: "54f68a0f-f3a5-4b52-9233-9ca12ae2bde1"
level: "task"
title: "A re-plan reuses the earlier plan's cut time only when the tree is unchanged"
status: "pending"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
source: "review-2026-10-12"
acceptanceCriteria:
  - "A re-plan of an unchanged tree reuses the earlier cutAt and writes an identical file (existing test)"
  - "A re-plan whose earlier plan has a different source.digest uses the current time and says the cut time was reset (test)"
  - "--cut-at overrides both (test)"
  - "domain-layer-boundary passes"
description: "Ported from the 2026-10-12 review of #688 (local C1 task 90072f73, fixed there but never pushed); the defect is still in #715. packages/rex/src/cli/commands/migrate-plan.ts:91-96 resolveCutAt returns previous?.header.cutAt without comparing previous.header.source.digest with the tree being planned.\n\nFailure scenario: --out=/shared/plan.json for project A with --cut-at 2020-01-01, then the same --out for project B: B's plan is written silently with cutAt 2020-01-01. In one project, a plan made weeks ago and re-run after the tree changed keeps the old cut time. cutAt is the appliedAt fallback for completed items without completedAt and the date and id seed of apply's cut change, so stale dates land in the v2 tree. Answer reuse stays safe (keyed by content hash).\n\nFix (as C1 did): reuse the earlier cutAt only when its source.digest matches this tree (reach sourceDigest through a module migrate-plan.ts already imports, e.g. a re-export from migrations/v1-to-v2/index.ts, so the rex cli/commands import surface test stays green); otherwise use now and say the cut time was reset. --cut-at always wins. The info line already prints the cut time."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T03:33:44.301Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

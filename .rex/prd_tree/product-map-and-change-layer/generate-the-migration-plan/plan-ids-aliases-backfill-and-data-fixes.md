---
id: "e2315cfa-849d-4bd0-b7f7-1b426b63bfbd"
level: "task"
title: "Plan ids, aliases, backfill and data fixes"
status: "pending"
priority: "high"
tags:
  - "pr-13"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "6b78242d-169b-4db5-8a6f-dee4d78da413"
source: "roadmap"
acceptanceCriteria:
  - "Re-running --plan on an unchanged tree produces an identical plan"
  - "Each data problem class is flagged in the plan"
description: "Criterion ids in source order; aliases for folded ids; shippedIn backfill from the first release tag after completion, overridden by PR merge data; flags for criteria stored in tags, duplicate titles, legacy parentId fields and stale descriptions. The plan is keyed by item id so it can be re-applied to a newer tree."
lastModified: "2026-10-06T04:19:37.203Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

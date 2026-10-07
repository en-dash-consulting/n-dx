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
  - "An item whose loe is a legacy bucket converts with no numeric loe and \"Legacy estimate: <bucket>\" at the start of loeRationale (test)"
  - "\"[object Object]\" recommendationMeta and log values are dropped and counted in the plan (test)"
description: "Criterion ids in source order; aliases for folded ids; shippedIn backfill from the first release tag after completion, overridden by PR merge data; flags for criteria stored in tags, duplicate titles, legacy parentId fields and stale descriptions. The plan is keyed by item id so it can be re-applied to a newer tree.\n\nTwo more fixes from Prepare task phase 2:\n- Legacy loe strings: older docs told people to write xs|s|m|l|xl, and v1 still preserves those as strings, which v2's numeric loe rejects. Drop the numeric loe for such items and keep the bucket as text by prefixing loeRationale with \"Legacy estimate: <bucket>\". Do not map buckets to weeks: that would invent estimates nobody made.\n- Corrupt values: 289 recommendationMeta values and 2 log entries in this repository are the literal string \"[object Object]\" (written by a pre-squash build in 015b06ad9; the data is unrecoverable, and v1 no longer writes it since #526). Drop them at conversion and report the count in the plan."
lastModified: "2026-10-06T19:49:45.874Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

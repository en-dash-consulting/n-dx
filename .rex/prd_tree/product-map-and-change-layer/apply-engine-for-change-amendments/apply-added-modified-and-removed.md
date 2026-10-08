---
id: "17a8312b-14b6-45c8-8908-a51dad483249"
level: "task"
title: "Apply added, modified and removed amendments to the product layer"
status: "completed"
priority: "high"
tags:
  - "pr-10"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
startedAt: "2026-10-07T22:31:28.848Z"
completedAt: "2026-10-07T22:41:07.382Z"
endedAt: "2026-10-07T22:41:07.382Z"
resolutionType: "code-change"
resolutionDetail: "Added rex core/apply-amendments.ts (pure, deterministic apply of added/modified/removed amendments with History, metAt, appliedIn) and tests covering each delta, body-independent hash and touches-only on disk."
acceptanceCriteria:
  - "Each delta kind has tests including replace and remove by criterion id"
  - "Editing a capability's prose body does not change its hash"
  - "Applying a touches-only change leaves product/ untouched"
description: "added creates the capability under its target area or capability; modified adds, replaces or removes criteria by id, or writes the reviewed proposed statement and criteria when present; removed retires the node. Append a History line, stamp metAt (hash of statement plus criteria only, never the body) and appliedIn. A touches-only change writes nothing under product/."
lastModified: "2026-10-07T22:41:07.625Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

---
id: "21d8ea06-e366-4411-9f2e-ab49b500ede3"
level: "task"
title: "Change selection descends into a change nested under another change"
status: "pending"
priority: "low"
tags:
  - "rex"
  - "v2"
  - "change-selection"
source: "overnight-side-session"
acceptanceCriteria:
  - "Selection never selects as a unit of work a change whose children include a change; it selects within the nested change (test)"
  - "resolveWorkById resolves a task under a nested change (test)"
  - "Selection over a tree with no nested changes is unchanged (test)"
description: "Nested changes are legal in v2 (decision D3 on e4a59da8, 2026-10-10): addChangeNode nests a change under an open change, and the v1 bundle import produces them. core/change-selection.ts does not handle them: an outer change with no task children is treated as task-less and selected as a unit of work, although it contains a change, and resolveWorkById can return null for a task under the inner change. Make selection treat a change whose children are changes as a container and descend into them."
lastModified: "2026-10-10T17:42:33.636Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

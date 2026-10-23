---
id: "21d8ea06-e366-4411-9f2e-ab49b500ede3"
type: "change"
title: "Change selection descends into a change nested under another change"
slug: "change-selection-descends-into-a"
intent: "Nested changes are legal in v2 (decision D3 on e4a59da8, 2026-10-10): addChangeNode nests a change under an open change, and the v1 bundle import produces them. core/change-selection.ts does not handle them: an outer change with no task children is treated as task-less and selected as a unit of work, although it contains a change, and resolveWorkById can return null for a task under the inner change. Make selection treat a change whose children are changes as a container and descend into them.\n\nMoved under feature b86f9199 on 2026-10-12: fixed by task 214ed10c (T4, get_next_task and rex next pick v2 work with findNextWork) and closed when T4 is verified."
acceptanceCriteria:
  - "Selection never selects as a unit of work a change whose children include a change; it selects within the nested change (test)"
  - "resolveWorkById resolves a task under a nested change (test)"
  - "Selection over a tree with no nested changes is unchanged (test)"
amends: [{"target":"b86f9199-bd84-45e8-95a8-bad39e42ebeb","delta":"modified","summary":"Change selection descends into a change nested under another change","base":"9e3d89e71764ed69cf49887326df90222cb2570d60b12d01e6034cc3a2d86a73"}]
priority: "low"
tags:
  - "rex"
  - "v2"
  - "change-selection"
  - "pr-34"
source: "overnight-side-session"
---

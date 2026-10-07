---
id: "05c59931-8008-40f1-aec2-f8a7c78d3106"
level: "task"
title: "Record which task or run found a change (discoveredFrom)"
status: "in_progress"
priority: "medium"
tags:
  - "pr-27"
  - "lane-rex-store"
  - "rex"
blockedBy:
  - "761ab00d-e31b-4e8a-9c86-a4bde4584471"
source: "roadmap"
startedAt: "2026-10-07T16:09:51.050Z"
acceptanceCriteria:
  - "discoveredFrom is an optional field on change intent with optional item and run ids"
  - "The v2 schema tests cover a change with and without it"
description: "Follow-ups land in the Inbox or the review follow-ups feature, but nothing records which task or run found them. Beads models this as a discovered-from link. Add an optional discoveredFrom field to change intent: { item?: <change or task id>, run?: <hench run id> }. Schema only in this task; the writers that fill it (an agent's add_item during a run, the review pass's captures, rex add --discovered-from) come with the MCP, CLI and hench brief PRs."
lastModified: "2026-10-07T16:09:51.282Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

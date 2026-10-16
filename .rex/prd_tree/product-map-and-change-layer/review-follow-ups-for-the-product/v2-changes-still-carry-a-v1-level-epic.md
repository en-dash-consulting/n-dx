---
id: "a0940ce9-0e01-4a5e-8ef6-8b8400067987"
level: "task"
title: "v2 changes still carry a v1 level (epic) in MCP and CLI output"
status: "pending"
priority: "low"
tags:
  - "lane-migration"
  - "rex"
  - "mcp"
source: "rehearsal gate item 6/7, fresh session 2026-10-16"
acceptanceCriteria:
  - "On a v2 tree, get_next_task and get_item omit level (or label by type) for changes, tasks and subtasks (test)"
  - "rex next prints the v2 type, not [epic], on a v2 tree (test)"
description: "Found by rehearsal gate items 6 and 7 (fresh Claude Code session in a rules-only migrated copy of this repository at the L6 tip 40ff3efd2, 2026-10-16; report in the workshop status.md). Not a cut blocker: every MCP write and both skills worked. get_next_task and get_item return \"type\": \"change\" together with \"level\": \"epic\" for a change, and rex next prints \"[epic] …\". The plan's after-the-cut list has \"'epic' wording out of rex and dashboard payloads\"; this is that item for rex's MCP and CLI output. Soft freeze: MCP payload shape; keep level for v1 trees."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T18:23:33.714Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

---
id: "a0940ce9-0e01-4a5e-8ef6-8b8400067987"
level: "task"
title: "v2 changes still carry a v1 level (epic) in MCP and CLI output"
status: "completed"
priority: "low"
tags:
  - "lane-migration"
  - "rex"
  - "mcp"
  - "v2-migrate-l7"
source: "rehearsal gate item 6/7, fresh session 2026-10-16"
startedAt: "2026-10-16T22:13:30.953Z"
completedAt: "2026-10-16T22:13:30.953Z"
endedAt: "2026-10-16T22:13:30.953Z"
acceptanceCriteria:
  - "rex next prints [change], [task] or [subtask] on a v2 tree, never [epic] (test)"
  - "get_next_task and get_item keep level on a v2 tree and say in their descriptions that type is authoritative (tool-list snapshot)"
  - "The release note deprecates level on v2 payloads"
description: "Found by rehearsal gate items 6 and 7 (fresh Claude Code session in a rules-only migrated copy of this repository at the L6 tip 40ff3efd2, 2026-10-16; report in the workshop status.md). Not a cut blocker: every MCP write and both skills worked. get_next_task and get_item return \"type\": \"change\" together with \"level\": \"epic\" for a change, and rex next prints \"[epic] …\". The plan's after-the-cut list has \"'epic' wording out of rex and dashboard payloads\"; this is that item for rex's MCP and CLI output. Soft freeze: MCP payload shape; keep level for v1 trees.\n\nDecided by Ryan, 2026-10-16: keep level in v2 payloads for this release. On a v2 tree it is derived from type and nesting (layer-projection.ts), v1-era clients read it, and get_next_task deliberately kept the v1 fields beside type (2a41f9c46). Removing it now would be a soft-freeze shape change on a few surfaces only (MCP, CLI JSON), leaving the REST API and bundles with it. So: fix what people see (rex next labels v2 work by type), say in the get_next_task and get_item descriptions that type is authoritative, deprecate level on v2 in the release note, and drop it from every v2 payload together in the release that refuses v1 (follow-up beside 2ea252fe). Done in 47e920694; run b62cfc77's full removal stays reverted (98fe046ea)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T22:13:33.052Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

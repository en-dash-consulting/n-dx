---
id: "9a194a0d-e07f-40d3-8d8d-ce4c59eb0f7c"
type: "task"
title: "MCP writes on a v2 tree do not stamp lastModified / lastModifiedBy"
slug: "mcp-writes-on-a-v2-tree-do-not-stamp"
description: "Found by rehearsal gate items 6 and 7 (fresh Claude Code session in a rules-only migrated copy of this repository at the L6 tip 40ff3efd2, 2026-10-16; report in the workshop status.md). Not a cut blocker: every MCP write and both skills worked. After update_task_status and edit_item on change 366c66ff, its state.yaml still read lastModified 2026-10-15T16:13Z by Sterling H; a change created through add_item had no lastModified at all. On v1 the store stamps these (Stamp lastModified on FolderTreeStore writes). Remote sync and the dashboard read lastModified, so v2 writes look stale."
acceptanceCriteria:
  - "update_task_status, edit_item, add_item and move_item on a v2 tree stamp lastModified and lastModifiedBy on the nodes they write (test)"
  - "A write that changes nothing stamps nothing (test)"
priority: "medium"
tags:
  - "lane-migration"
  - "rex"
  - "mcp"
  - "v2-migrate-l7"
source: "rehearsal gate item 6/7, fresh session 2026-10-16"
---

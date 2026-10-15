---
id: "61044424-6892-46b8-8b11-131e57373c91"
level: "feature"
title: "v2 MCP tools take display ids and report v2 health"
status: "pending"
priority: "medium"
tags:
  - "v2-hardening"
  - "rex"
source: "roadmap"
startedAt: "2026-10-15T06:46:35.329Z"
endedAt: "2026-10-15T06:46:35.329Z"
acceptanceCriteria: []
description: "v2 hardening 3/5 (2026-10-14). The rex MCP tools that look an item up by id accept a v2 display id (CH-1) or alias as get_item does, and MCP health reports the v2 tree rules the CLI shows. Branch feat/v2-hardening-3-mcp."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T06:47:37.687Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [MCP health on a v2 tree returns an error instead of the score when package.json is malformed](./mcp-health-on-a-v2-tree-returns-an.md) | completed |
| [MCP health on a v2 tree scores the change projection with v1 dimensions](./mcp-health-on-a-v2-tree-scores-the.md) | completed |
| [MCP health on a v2 tree without .rex/config.json errors instead of returning its score](./mcp-health-on-a-v2-tree-without-rex.md) | pending |
| [On a v2 tree, edit_item, move_item, merge_items and claim_task reject a display id that get_item accepts](./on-a-v2-tree-edit-item-move-item-merge.md) | completed |
| [On a v2 tree, release_task leaves a claim held when given the display id claim_task accepted](./on-a-v2-tree-release-task-leaves-a.md) | completed |
| [update_task_status rejects a v2 display id that get_item accepts](./update-task-status-rejects-a-v2.md) | completed |

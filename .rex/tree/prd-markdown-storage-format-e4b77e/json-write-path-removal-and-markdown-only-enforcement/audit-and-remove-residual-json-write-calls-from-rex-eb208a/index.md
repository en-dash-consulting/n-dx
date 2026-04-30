---
id: "eb208a9e-1443-4fd0-8d1c-899dea1a2ba8"
level: "task"
title: "Audit and remove residual JSON write calls from rex CLI and MCP handlers"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "cli"
  - "mcp"
  - "cleanup"
source: "smart-add"
startedAt: "2026-04-29T02:06:16.128Z"
completedAt: "2026-04-29T02:15:01.144Z"
endedAt: "2026-04-29T02:15:01.144Z"
resolutionType: "code-change"
resolutionDetail: "Removed writeFile calls targeting prd.json and branch-scoped prd_*.json from resolvePRDFile (prd-discovery.ts) and cmdInit (init.ts). No production write code for prd.json remains in packages/rex/src outside the ndx-start cache path."
acceptanceCriteria:
  - "A grep for prd.json write patterns in packages/rex/src yields no production write code outside the ndx-start cache path"
  - "ndx add completes without creating or modifying .rex/prd.json"
  - "rex edit, rex remove, rex move, rex prune, and rex reshape each complete without touching .rex/prd.json"
  - "MCP write tools (add_item, edit_item, update_task_status, move_item, merge_items) complete without touching .rex/prd.json"
description: "Systematically audit all rex CLI command handlers (add, edit, remove, move, prune, reshape, reorganize, analyze, recommend) and MCP write tool handlers (add_item, edit_item, update_task_status, move_item, merge_items) for any direct or indirect JSON write calls that bypass PRDStore. Remove these call sites and ensure every mutation flows through the Markdown-only write path."
---

# Audit and remove residual JSON write calls from rex CLI and MCP handlers

🟠 [completed]

## Summary

Systematically audit all rex CLI command handlers (add, edit, remove, move, prune, reshape, reorganize, analyze, recommend) and MCP write tool handlers (add_item, edit_item, update_task_status, move_item, merge_items) for any direct or indirect JSON write calls that bypass PRDStore. Remove these call sites and ensure every mutation flows through the Markdown-only write path.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, cli, mcp, cleanup
- **Level:** task
- **Started:** 2026-04-29T02:06:16.128Z
- **Completed:** 2026-04-29T02:15:01.144Z
- **Duration:** 8m

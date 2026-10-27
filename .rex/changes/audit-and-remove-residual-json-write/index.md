---
id: "eb208a9e-1443-4fd0-8d1c-899dea1a2ba8"
type: "change"
title: "Audit and remove residual JSON write calls from rex CLI and MCP handlers"
slug: "audit-and-remove-residual-json-write"
intent: "Systematically audit all rex CLI command handlers (add, edit, remove, move, prune, reshape, reorganize, analyze, recommend) and MCP write tool handlers (add_item, edit_item, update_task_status, move_item, merge_items) for any direct or indirect JSON write calls that bypass PRDStore. Remove these call sites and ensure every mutation flows through the Markdown-only write path."
acceptanceCriteria:
  - "A grep for prd.json write patterns in packages/rex/src yields no production write code outside the ndx-start cache path"
  - "ndx add completes without creating or modifying .rex/prd.json"
  - "rex edit, rex remove, rex move, rex prune, and rex reshape each complete without touching .rex/prd.json"
  - "MCP write tools (add_item, edit_item, update_task_status, move_item, merge_items) complete without touching .rex/prd.json"
touches:
  - "21a86676-166a-4af7-bc57-39af1f47d2ba"
priority: "high"
tags:
  - "rex"
  - "cli"
  - "mcp"
  - "cleanup"
source: "smart-add"
---

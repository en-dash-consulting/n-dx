---
id: "7a7e8498-ca1b-4bed-94ca-0048f74eefe1"
level: "task"
title: "Wire resolveItem into MCP get_item and CLI commands that accept item identifiers"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "mcp"
  - "cli"
source: "smart-add"
startedAt: "2026-05-19T16:40:11.687Z"
completedAt: "2026-05-19T16:47:13.068Z"
endedAt: "2026-05-19T16:47:13.068Z"
resolutionType: "code-change"
resolutionDetail: "Wired resolveItem into handleGetItem (mcp-tools.ts), cmdUpdate (update.ts), and cmdRemove (remove.ts). All downstream canonical-UUID operations use the resolved item.id. Internal engine call sites (reorganize, reshape, move) unchanged. 9 new tests cover title resolution and non-matching-query error cases across all three entry points. 4211/4211 tests pass."
acceptanceCriteria:
  - "MCP get_item accepts a PRD item title and returns the item data"
  - "CLI commands that accept an item ID (rex update, rex remove) resolve by title when the input does not match any UUID"
  - "Internal engine call sites (reorganize, reshape, move) are not changed to use resolveItem"
  - "A non-matching query returns a user-facing error naming the unresolved query string"
description: "Replace direct `findItem` calls with `resolveItem` at the user-facing entry points where a human might reasonably type a title instead of a UUID: the MCP `get_item` tool handler, the `rex update` CLI command, and any other CLI command that accepts an `--id` or positional item-identifier argument. Internal engine calls that pass programmatically-generated IDs (e.g., reorganize, reshape) should keep using `findItem` directly to avoid accidental title collisions in automated flows."
---

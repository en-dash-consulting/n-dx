---
id: "7a7e8498-ca1b-4bed-94ca-0048f74eefe1"
level: "task"
title: "Wire resolveItem into MCP get_item and CLI commands that accept item identifiers"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "mcp"
  - "cli"
source: "smart-add"
acceptanceCriteria:
  - "MCP get_item accepts a PRD item title and returns the item data"
  - "CLI commands that accept an item ID (rex update, rex remove) resolve by title when the input does not match any UUID"
  - "Internal engine call sites (reorganize, reshape, move) are not changed to use resolveItem"
  - "A non-matching query returns a user-facing error naming the unresolved query string"
description: "Replace direct `findItem` calls with `resolveItem` at the user-facing entry points where a human might reasonably type a title instead of a UUID: the MCP `get_item` tool handler, the `rex update` CLI command, and any other CLI command that accepts an `--id` or positional item-identifier argument. Internal engine calls that pass programmatically-generated IDs (e.g., reorganize, reshape) should keep using `findItem` directly to avoid accidental title collisions in automated flows."
---

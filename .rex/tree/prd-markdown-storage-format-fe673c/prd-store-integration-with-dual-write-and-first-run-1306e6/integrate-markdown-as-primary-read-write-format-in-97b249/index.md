---
id: "97b24996-6ca7-46de-a2bf-1355ebc12e9f"
level: "task"
title: "Integrate markdown as primary read/write format in PRDStore with JSON dual-write"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "refactor"
source: "smart-add"
startedAt: "2026-04-24T15:54:10.082Z"
completedAt: "2026-04-28T15:08:27.304Z"
endedAt: "2026-04-28T15:08:27.304Z"
acceptanceCriteria:
  - "PRDStore.load() reads from .rex/prd.md when the file exists; falls back to .rex/prd.json when prd.md is absent"
  - "PRDStore.save() writes .rex/prd.md first, then syncs .rex/prd.json; a write error on the json sync is logged but does not throw"
  - "All rex commands (status, next, add, edit, update, move, merge) operate correctly with markdown as primary storage"
  - "MCP write tools (add_item, edit_item, update_task_status, move_item, merge_items) persist to prd.md and the json sync follows"
  - "prd.json content equals JSON.stringify(parse(prd.md)) after every mutation"
  - "All existing PRDStore unit and integration tests pass without modification"
description: "Update the PRD store (packages/rex/src/core/) to read from and write to .rex/prd.md as the primary storage file. On every save, also write the equivalent JSON to .rex/prd.json to keep it current for backward-compatible tooling. All existing store operations (load, save, add, edit, update, merge, move) must work transparently. The store falls back to reading .rex/prd.json if .rex/prd.md does not exist, enabling the migration path. Dual-write failure must not leave prd.md in an inconsistent state."
---

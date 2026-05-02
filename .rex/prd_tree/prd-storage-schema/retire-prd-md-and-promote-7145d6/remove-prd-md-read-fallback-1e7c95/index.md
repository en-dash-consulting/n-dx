---
id: "1e7c95da-5153-4634-8c19-f137a1195ebf"
level: "task"
title: "Remove prd.md read fallback from PRDStore and all CLI, MCP, and web consumers"
status: "completed"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "rex"
  - "mcp"
  - "web"
source: "smart-add"
startedAt: "2026-04-29T13:59:33.665Z"
completedAt: "2026-04-29T14:13:03.841Z"
endedAt: "2026-04-29T14:13:03.841Z"
resolutionType: "code-change"
resolutionDetail: "Implemented folder-tree-only PRD backend. Removed prd.md read fallback from FileStore.loadDocument(). Updated all CLI read paths and error handling to require folder tree. Parse-md now requires --stdin or --file flags."
acceptanceCriteria:
  - "PRDStore.loadDocument reads only from the folder tree; no prd.md read path exists"
  - "All rex CLI commands and MCP tools obtain PRD data through the folder-tree backend"
  - "Web server PRD aggregator sources data from the folder tree when ndx start is running"
  - "When no folder tree is present, the error message names the migration command"
  - "Integration tests confirm correct behavior with a folder-tree-only backend (no prd.md present)"
description: "Update PRDStore.loadDocument and every caller (rex CLI commands, MCP tools, web server PRD aggregator, ndx status) to read exclusively from the folder tree. Remove fallback logic that reads prd.md when a folder tree is absent. When no folder tree is found, emit a clear error directing the user to run the migration command rather than silently falling back."
---

# Remove prd.md read fallback from PRDStore and all CLI, MCP, and web consumers

🔴 [completed]

## Summary

Update PRDStore.loadDocument and every caller (rex CLI commands, MCP tools, web server PRD aggregator, ndx status) to read exclusively from the folder tree. Remove fallback logic that reads prd.md when a folder tree is absent. When no folder tree is found, emit a clear error directing the user to run the migration command rather than silently falling back.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** prd, storage, rex, mcp, web
- **Level:** task
- **Started:** 2026-04-29T13:59:33.665Z
- **Completed:** 2026-04-29T14:13:03.841Z
- **Duration:** 13m

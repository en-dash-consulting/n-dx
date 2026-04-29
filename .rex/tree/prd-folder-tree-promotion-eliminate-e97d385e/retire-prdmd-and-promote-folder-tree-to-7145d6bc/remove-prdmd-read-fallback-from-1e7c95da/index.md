---
id: "1e7c95da-5153-4634-8c19-f137a1195ebf"
level: "task"
title: "Remove prd.md read fallback from PRDStore and all CLI, MCP, and web consumers"
status: "pending"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "rex"
  - "mcp"
  - "web"
source: "smart-add"
acceptanceCriteria:
  - "PRDStore.loadDocument reads only from the folder tree; no prd.md read path exists"
  - "All rex CLI commands and MCP tools obtain PRD data through the folder-tree backend"
  - "Web server PRD aggregator sources data from the folder tree when ndx start is running"
  - "When no folder tree is present, the error message names the migration command"
  - "Integration tests confirm correct behavior with a folder-tree-only backend (no prd.md present)"
description: "Update PRDStore.loadDocument and every caller (rex CLI commands, MCP tools, web server PRD aggregator, ndx status) to read exclusively from the folder tree. Remove fallback logic that reads prd.md when a folder tree is absent. When no folder tree is found, emit a clear error directing the user to run the migration command rather than silently falling back."
---

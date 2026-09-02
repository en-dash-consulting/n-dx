---
id: "0d771f43-357d-4893-8d41-b33385ca0d30"
level: "task"
title: "Refactor PRDStore read operations to aggregate items across all PRD files"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "prd-store"
source: "smart-add"
startedAt: "2026-04-22T16:31:12.511Z"
completedAt: "2026-04-22T16:39:53.735Z"
resolutionType: "code-change"
resolutionDetail: "Refactored FileStore.loadDocument() to aggregate items from all prd_*.json files plus legacy prd.json. Added loadSingleFile(), mergeDocuments() private helpers. ID collision detection throws with filename details. withTransaction isolated to primary prd.json for write safety."
acceptanceCriteria:
  - "PRDStore load path merges items from every prd_*.json file in .rex/"
  - "Item IDs remain globally unique — ID collision across files is detected and reported"
  - "rex status shows items from all PRD files in a single unified tree"
  - "rex next considers tasks from all PRD files for priority-based selection"
  - "MCP read tools (get_prd_status, get_item, get_next_task) return aggregated data from all files"
  - "No existing command behavior changes beyond the storage source being multiple files"
description: "Modify the PRDStore's load and query paths to discover all prd_*.json files in .rex/, parse each one, and merge their item trees into a single unified in-memory representation. All downstream consumers (status, next, search, validate, MCP reads, web dashboard) should see a complete view of all items across all PRDs without requiring code changes at the consumer level."
---

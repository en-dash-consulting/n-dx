---
id: "6fa1218b-b843-429c-886e-154b93c16145"
level: "task"
title: "Audit all read and write call sites that still reference prd.md as primary storage"
status: "completed"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "audit"
source: "smart-add"
startedAt: "2026-04-29T13:57:29.197Z"
completedAt: "2026-04-29T13:59:19.174Z"
endedAt: "2026-04-29T13:59:19.174Z"
resolutionType: "code-change"
resolutionDetail: "Created AUDIT-prd-md-calls.md documenting all prd.md read/write paths with line references, callers, and folder-tree replacement targets. Identified 3 write paths in file-adapter.ts + 1 in prd-md-migration.ts, 2 read paths in file-adapter.ts and parse-md.ts. All abstract through FileStore; minimal code changes needed for most consumers once backend swaps to folder-tree. Committed as 92a86e77.\""
acceptanceCriteria:
  - "All prd.md read callers are identified with file and line references"
  - "All prd.md write callers are identified with file and line references"
  - "Branch-scoped prd_{branch}_{date}.md paths are included in the audit"
  - "Audit output is committed as a short-lived doc or comment block consumed by follow-up tasks"
description: "Trace every code path in PRDStore, rex CLI commands, MCP handlers, ndx orchestration scripts, and the web server that reads from or writes to prd.md (including branch-scoped variants). Produce a prioritized change list mapping each path to its folder-tree replacement before any implementation begins."
---

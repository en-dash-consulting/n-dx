---
id: "6fa1218b-b843-429c-886e-154b93c16145"
type: "task"
title: "Audit all read and write call sites that still reference prd.md as primary storage"
slug: "audit-all-read-and-write-call-sites"
description: "Trace every code path in PRDStore, rex CLI commands, MCP handlers, ndx orchestration scripts, and the web server that reads from or writes to prd.md (including branch-scoped variants). Produce a prioritized change list mapping each path to its folder-tree replacement before any implementation begins."
acceptanceCriteria:
  - "All prd.md read callers are identified with file and line references"
  - "All prd.md write callers are identified with file and line references"
  - "Branch-scoped prd_{branch}_{date}.md paths are included in the audit"
  - "Audit output is committed as a short-lived doc or comment block consumed by follow-up tasks"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "audit"
source: "smart-add"
---

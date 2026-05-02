---
id: "bbf2dd9a-3f5a-4bb9-a263-ca8931caaaa5"
level: "task"
title: "Profile prd_tree write path and identify bottlenecks for single-item add and edit operations"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "performance"
  - "prd"
source: "smart-add"
startedAt: "2026-05-01T14:17:39.295Z"
acceptanceCriteria:
  - "Profiling harness measures end-to-end latency for ndx add and rex edit_item on small/medium/large fixture PRDs"
  - "Top three bottlenecks are documented with file paths and measured cost in milliseconds"
  - "Profiling artifacts checked in under tests/ or scripts/ for repeatable runs"
  - "Baseline numbers recorded so subsequent optimization tasks can verify improvement"
description: "Instrument the folder-tree write path (slug generation, parent traversal, index.md serialization, file write, cache refresh) and capture timing on representative PRDs (small ~20 items, medium ~200 items, large ~1000 items). Identify the top three latency contributors and document them with concrete file:line references."
---

# Profile prd_tree write path and identify bottlenecks for single-item add and edit operations

🟠 [pending]

## Summary

Instrument the folder-tree write path (slug generation, parent traversal, index.md serialization, file write, cache refresh) and capture timing on representative PRDs (small ~20 items, medium ~200 items, large ~1000 items). Identify the top three latency contributors and document them with concrete file:line references.

## Info

- **Status:** pending
- **Priority:** high
- **Tags:** rex, performance, prd
- **Level:** task
- **Started:** 2026-05-01T14:17:39.295Z

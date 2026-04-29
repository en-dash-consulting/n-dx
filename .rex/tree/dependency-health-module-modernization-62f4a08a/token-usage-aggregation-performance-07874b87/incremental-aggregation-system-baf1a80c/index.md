---
id: "baf1a80c-fbe1-4df9-a08b-d1cfec3d0e6f"
level: "task"
title: "Incremental Aggregation System"
status: "completed"
source: "smart-add"
startedAt: "2026-02-26T16:38:30.297Z"
completedAt: "2026-02-26T16:38:30.297Z"
acceptanceCriteria: []
description: "Replace full aggregation rebuilds with efficient incremental updates to handle large run histories"
---

## Subtask: Implement incremental token usage updates instead of full rebuilds

**ID:** `543d10ae-d04a-4db7-b912-c933b481f6c4`
**Status:** completed
**Priority:** high

Replace the current full aggregation rebuild in aggregateTaskUsage() with an incremental system that only processes new or changed run files since the last aggregation

**Acceptance Criteria**

- aggregateTaskUsage() only processes new/modified run files on subsequent calls
- Initial aggregation still processes all existing run files
- Aggregation time remains constant regardless of total run history size
- Token usage totals remain accurate after incremental updates

---

## Subtask: Add run file change detection and delta processing

**ID:** `f7cc9444-d052-422e-a59c-e9f8e56a97a3`
**Status:** completed
**Priority:** high

Implement file system monitoring or timestamp-based detection to identify which run files need processing, enabling efficient delta aggregation

**Acceptance Criteria**

- System detects new run files added since last aggregation
- System detects modified run files and re-processes them
- Delta processing handles file deletions gracefully
- Change detection works reliably across process restarts

---

## Subtask: Implement aggregation result caching with invalidation

**ID:** `ed2a3c6f-6b4b-4e03-8d31-c4ac8c7255e5`
**Status:** completed
**Priority:** medium

Cache computed aggregation results to avoid redundant processing, with smart invalidation when underlying run data changes

**Acceptance Criteria**

- Aggregation results are cached between polling intervals
- Cache is invalidated when new run files are detected
- Cache keys properly differentiate between different task scopes
- Memory usage of cache is bounded and doesn't grow indefinitely

---

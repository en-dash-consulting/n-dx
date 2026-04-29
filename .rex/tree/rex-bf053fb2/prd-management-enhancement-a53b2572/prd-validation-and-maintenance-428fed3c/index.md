---
id: "428fed3c-fa27-455f-a39e-f882f344fab3"
level: "task"
title: "PRD Validation and Maintenance"
status: "completed"
source: "llm"
startedAt: "2026-02-09T18:57:45.040Z"
completedAt: "2026-02-09T19:49:06.320Z"
acceptanceCriteria: []
description: "Enhanced validation and cleanup tools for PRD integrity\n\n---\n\nRobust schema validation with migration support, combined with reliable store operations for configuration and workflow persistence\n\n---\n\nRobust handling of task status transitions and blockedBy dependencies with proper validation, error messages, and edge case handling"
---

## Subtask: Enhance rex validate with structural checks

**ID:** `4741b835-bbcf-4cfd-b5b5-27e1bc0cb5a5`
**Status:** completed
**Priority:** high

Add checks for orphaned items, circular blockedBy dependencies, and stuck in_progress tasks

**Acceptance Criteria**

- Detects orphaned tasks with no parent
- Identifies circular dependency chains
- Flags tasks stuck in in_progress too long

---

## Subtask: Timestamp and status-field consistency validation

**ID:** `9fcb6935-a870-4e5a-9e0a-7a93dade0a3e`
**Status:** completed
**Priority:** high

Add new validation checks to structural.ts: (1) completed items must have completedAt, (2) in_progress items must have startedAt, (3) startedAt must be before completedAt when both exist, (4) no future timestamps, (5) parent cannot be completed when children are pending/in_progress. Wire into validate command output. TDD: write failing tests first.

---

## Subtask: Auto-fix command for common PRD issues

**ID:** `a2453828-c113-4e6b-80c4-103b06db9df9`
**Status:** completed
**Priority:** medium

Add a rex fix command that auto-repairs common validation issues: (1) add missing timestamps to items based on status, (2) clear orphan blockedBy references, (3) align parent status with child states. Support --dry-run flag and JSON output.

---

## Subtask: Implement schema validation and core store operations

**ID:** `1cc66bdf-4559-406e-9f7a-2bb1ecb5f43a`
**Status:** completed
**Priority:** high

Comprehensive schema validation for all data structures with backwards compatibility for legacy formats, combined with core store operations for configuration and workflow management. Validation feeds into storage — the store validates what it persists, and migration support handles legacy formats on load.

**Acceptance Criteria**

- Validates configs, run records, manifests, documents, inventory, imports, and zones
- Rejects invalid values (bad status, priority, level, format, role, import type, finding type, number values)
- Accepts legacy data formats with appropriate defaults (optional fields, missing retry section, backward-compat run fields)
- Provides clear, actionable error messages for each validation failure
- Loads and round-trips workflow content
- Loads and round-trips config (including from local file)
- Appends and reads log entries in chronological order
- Store operations validate data before persisting

---

## Subtask: Add blocked status distinct from deferred

**ID:** `73cbf527-e71e-497f-b37c-6d4878e19630`
**Status:** completed
**Priority:** high

Implement blocked status for tasks that can't proceed due to dependencies, separate from deferred tasks. Blocked items display their blockedBy dependencies in status/next output, are excluded from task selection, and require transitioning through pending/in_progress before completion.

**Acceptance Criteria**

- Blocked status prevents task selection in next command
- Blocked tasks show dependency information
- Status transitions validate blocked→ready path

---

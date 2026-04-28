---
id: "f7f698a6-7712-4713-a02a-d60535d24789"
level: "task"
title: "Command Validation"
status: "completed"
source: "llm"
startedAt: "2026-02-06T15:39:26.006Z"
completedAt: "2026-02-06T15:39:26.006Z"
description: "Improve command input validation and safety\n\n---\n\nConsistent JSON output formats across commands"
---

## Subtask: Enhance path security validation

**ID:** `b68a4841-3041-4c13-9e93-199b1eb13c0f`
**Status:** completed
**Priority:** critical

Hardened path security validation via TDD. Fixed simpleGlobMatch to block directory roots (dir/** now matches dir itself), added null-byte rejection to validatePath, and added 10 new test cases covering: directory root bypass, null byte injection, ? wildcard edge cases, Windows backslash normalization, absolute path handling, internal traversal. All 333 tests pass.

**Acceptance Criteria**

- Path traversal attacks are prevented
- Glob patterns work correctly
- Blocked paths are enforced

---

## Subtask: Implement command input validation

**ID:** `6bfb1e50-3b56-41ef-a93f-bd3e71a9f3aa`
**Status:** completed
**Priority:** high

Validate command inputs (add, update, status) with clear error messages including valid options and usage hints

**Acceptance Criteria**

- Throws CLIError for invalid hierarchy with valid levels in suggestion
- Throws CLIError when parent is required but missing, with suggestion to check status
- Succeeds for valid epic with title
- Integer parsing handles edge cases with appropriate defaults
- Includes usage hint when update ID is missing
- Throws CLIError when no updates specified, listing available flags
- Throws CLIError for unrecognized output format, suggesting valid formats

---

## Subtask: Implement smart defaults and flexible hierarchy

**ID:** `4a10b43a-2675-452c-9692-926402d6e133`
**Status:** completed
**Priority:** medium

Intelligent level inference, flexible hierarchy (tasks under epics), and blockedBy support in add command

**Acceptance Criteria**

- Defaults to epic when no level and no parent
- Infers feature when parent is an epic and no level given
- Errors when parent not found during inference
- Explicit level overrides inference
- Accepts tasks directly under epics while still allowing tasks under features
- Rejects adding tasks under subtasks or without any parent
- Feature level remains optional — epics can have both features and tasks
- Accepts --blockedBy as comma-separated IDs

---

## Subtask: Ensure init commands create valid configuration files

**ID:** `27ac198d-2a28-4c80-8870-d1ba3544840f`
**Status:** completed
**Priority:** medium

Validate that hench and rex init commands properly create valid config.json and prd.json files

**Acceptance Criteria**

- Hench init creates valid config.json
- Rex init creates valid prd.json
- Both commands are idempotent on re-run

---

## Subtask: Implement JSON report command

**ID:** `3371ae43-1936-4085-a1a0-0a42fee0d3c5`
**Status:** completed
**Priority:** medium

Structured JSON reports with health status, progress, level breakdown, and proper exit codes

**Acceptance Criteria**

- Outputs valid JSON with timestamp, ok field, progress percentage, and breakdown by level
- ok is true for valid PRD; includes warnings without affecting ok status
- Does not exit non-zero on validation errors unless --fail-on-error is set
- Exits 0 when --fail-on-error and health is good; exits 1 when bad
- Counts items per level and status; omits levels with zero items

---

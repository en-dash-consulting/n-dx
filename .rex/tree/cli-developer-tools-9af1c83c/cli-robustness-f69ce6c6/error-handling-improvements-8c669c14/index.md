---
id: "8c669c14-56ac-476d-90e4-18bac1afce18"
level: "task"
title: "Error Handling Improvements"
status: "completed"
source: "llm"
startedAt: "2026-02-06T14:35:05.946Z"
completedAt: "2026-02-06T14:35:05.946Z"
description: "Better error messages and graceful degradation"
---

## Subtask: Enhance input validation with helpful errors

**ID:** `79e45114-9bc1-4337-bfc7-c1c2e0d85a73`
**Status:** completed
**Priority:** high

Provide clear error messages with suggestions for invalid inputs

**Acceptance Criteria**

- Throws CLIError for non-numeric values
- Throws CLIError for negative values
- Throws CLIError for zero
- Includes positive integer suggestion

---

## Subtask: Add dependency validation

**ID:** `6bff530e-bae5-4b1c-bbdf-e3b13b092122`
**Status:** completed
**Priority:** high

Validate external dependencies and provide helpful installation guidance. Implemented: requireClaudeCLI() checks for claude binary on PATH, throws CLIError with npm install instructions and API provider fallback suggestion. Called early in cmdRun for cli provider. Full test coverage for all acceptance criteria.

**Acceptance Criteria**

- Throws CLIError when claude is not on PATH
- Includes install instructions in the suggestion
- Suggests API provider as fallback
- Does not throw when claude is available

---

## Subtask: Improve CLI error handling and validation

**ID:** `4b2f9165-0f17-4060-b439-41e7ee7c4c33`
**Status:** completed
**Priority:** high

Enhance error formatting, graceful dependency handling, move operation validation, and directory validation with clear actionable messages

**Acceptance Criteria**

- Error messages are user-friendly without stack traces
- Missing dependencies show clear install instructions with fallback suggestions
- Move operations throw CLIError for circular and no-op moves
- Missing directories/items throw CLIError with n-dx init suggestion
- Common errors include helpful suggestions

---

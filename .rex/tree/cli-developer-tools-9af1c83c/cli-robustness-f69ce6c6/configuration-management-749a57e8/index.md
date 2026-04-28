---
id: "749a57e8-c3c2-4a85-9603-298f69766902"
level: "task"
title: "Configuration Management"
status: "completed"
source: "llm"
startedAt: "2026-02-06T15:17:39.610Z"
completedAt: "2026-02-06T15:17:39.610Z"
description: "Robust configuration loading, validation, and project-level overrides"
---

## Subtask: Add configuration defaults and validation

**ID:** `bb7791ec-b388-44cd-8b8f-91754bbe0b87`
**Status:** completed
**Priority:** high

Provide sensible defaults and validate configuration values. All three config fields (tokenBudget, maxFailedAttempts, loopPauseMs) are optional in the Zod schema with sensible defaults, and validated against invalid values. Comprehensive test coverage added.

**Acceptance Criteria**

- tokenBudget is optional in schema and defaults to 0 (unlimited)
- maxFailedAttempts is optional in schema and defaults to 3
- loopPauseMs is optional in schema and defaults to 2000
- maxFailedAttempts can be customised in config
- loopPauseMs can be customised in config
- rejects maxFailedAttempts of 0
- rejects negative maxFailedAttempts
- tokenBudget can be set to a positive value
- rejects negative tokenBudget
- accepts tokenBudget of 0 (unlimited)
- validates existing configs without tokenBudget field (backward compat)
- rejects negative loopPauseMs

---

## Subtask: Add task failure handling

**ID:** `26961fc1-9711-4dee-beda-b698b1a48384`
**Status:** completed
**Priority:** high

Properly handle various task failure scenarios with appropriate status updates.

## Implementation

All three failure handling paths are implemented in `packages/hench/src/agent/loop.ts`:

1. **Uncaught exception** (lines 325-334): catch block marks task as `deferred`, logs `task_failed` event
2. **Timeout** (lines 315-323): when loop exits while still `running`, marks task as `deferred`, logs `task_failed` event  
3. **Budget exceeded** (lines 222-234): per-turn budget check marks task as `pending` (recoverable), logs `budget_exceeded` event

Tests: `packages/hench/tests/unit/agent/task-failure.test.ts` (3 tests, all passing)

**Acceptance Criteria**

- Marks task as deferred on uncaught exception and logs error
- Marks task as deferred on timeout and logs error
- Marks task as pending on budget exceeded and logs error

---

## Subtask: Implement project-level configuration

**ID:** `c70b3fac-76ff-4563-9b99-0a35dfad37f3`
**Status:** completed
**Priority:** medium

Support .n-dx.json project-level config files that merge with and override package configs

**Acceptance Criteria**

- Reads .n-dx.json and merges with package configs
- Project config takes precedence over package config
- Deep merges nested objects; array override replaces entire array
- Set writes to package config, not .n-dx.json
- Ignores .n-dx.json with no hench/rex section

---

## Subtask: Implement config get/set with validation and docs

**ID:** `e7e40a00-1ddd-4588-92d8-43805607f123`
**Status:** completed
**Priority:** medium

Config display, get/set by dotted key, JSON output, validation rules, and help text for all config options

**Acceptance Criteria**

- Displays all package configs, skipping missing packages gracefully
- Gets values by dotted key (string, number, nested, array, whole package)
- Sets values with type coercion (string, number, nested, new optional fields)
- Outputs single value and package config as JSON
- Errors on missing key/package, prevents modifying schema version, rejects unknown packages
- Prevents setting sourcevision (read-only) and object keys directly
- Help text documents all rex/hench config keys, guard keys, type coercion rules, and .n-dx.json

---

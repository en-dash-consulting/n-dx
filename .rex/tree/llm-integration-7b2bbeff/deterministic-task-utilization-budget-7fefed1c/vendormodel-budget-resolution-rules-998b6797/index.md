---
id: "998b6797-852b-4ddd-8397-2994655037d1"
level: "task"
title: "Vendor/Model Budget Resolution Rules"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T19:41:05.267Z"
completedAt: "2026-02-22T19:41:05.267Z"
acceptanceCriteria: []
description: "Define a deterministic resolution path for weekly token budgets so task-level utilization always computes from a known source or a consistent fallback state."
---

## Subtask: Implement deterministic weekly budget resolver for vendor/model scopes

**ID:** `bcd84e21-a87c-4b2f-9ffa-7a7c27eee436`
**Status:** completed
**Priority:** critical

Create a single resolver that selects the weekly budget in a fixed order to eliminate ambiguous behavior when model-specific configuration is missing.

**Acceptance Criteria**

- Resolver checks budget sources in documented order: vendor+model, vendor default, global default, then explicit no-budget
- Given matching vendor+model budget, resolver returns that value and source `vendor_model`
- Given missing model budget but present vendor default, resolver returns vendor default and source `vendor_default`
- Given no configured budget at any level, resolver returns a no-budget sentinel and source `missing_budget`

---

## Subtask: Validate weekly budget configuration and emit stable fallback diagnostics

**ID:** `b3c66cf5-1e2e-4c9c-b8aa-ef5e7fce9459`
**Status:** completed
**Priority:** high

Harden config loading so invalid or partial budget data cannot produce inconsistent utilization calculations across runs.

**Acceptance Criteria**

- Invalid budget entries (non-numeric, negative, NaN) are rejected with actionable validation errors
- Config parsing normalizes vendor/model keys consistently before lookup
- When lookup falls back or returns missing-budget, a machine-readable reason code is emitted for downstream UI use
- Unit tests cover valid, partial, and invalid budget configurations

---

---
id: "e99c65c7-a62f-4bc9-950c-097a98b6df83"
level: "task"
title: "Run quality and guardrails"
status: "completed"
source: "llm"
startedAt: "2026-02-04T18:11:41.993Z"
completedAt: "2026-02-04T18:11:41.993Z"
acceptanceCriteria: []
description: "Validate work quality and provide safety mechanisms for autonomous execution"
---

## Subtask: Add completion validation

**ID:** `c953070b-ef5a-4793-aaca-27144bed45c0`
**Status:** completed
**Priority:** high

Validate meaningful changes were made before marking tasks complete

**Acceptance Criteria**

- Checks git diff is non-empty
- Optionally runs tests for verification
- Prevents false completion claims

---

## Subtask: Implement review mode

**ID:** `da30cf47-a66f-4c72-9843-30472b2eb384`
**Status:** completed
**Priority:** medium

Add --review flag to show proposed changes before committing

**Acceptance Criteria**

- Shows agent's proposed changes
- User can approve or reject
- Changes only applied after approval

---

## Subtask: Add structured run summaries

**ID:** `8817fcaf-2f8d-4f9a-8cc8-dca1a3795250`
**Status:** completed
**Priority:** medium

Include structured metadata in run records

**Acceptance Criteria**

- Records files changed
- Tracks tests run
- Lists commands executed
- Summary easily parseable

---

## Subtask: Implement token budget limits

**ID:** `c79338e3-1f96-40d8-af79-a2dc334f75e6`
**Status:** completed
**Priority:** low

Cap total token spend per run with configurable budget

**Acceptance Criteria**

- Configurable token budget per run
- Run stops when budget exceeded
- Budget separate from max turns limit

---

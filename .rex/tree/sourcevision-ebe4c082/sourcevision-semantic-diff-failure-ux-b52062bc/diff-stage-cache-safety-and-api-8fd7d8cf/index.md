---
id: "8fd7d8cf-391f-4caf-a205-928c9d788a34"
level: "task"
title: "Diff-stage cache safety and API diagnostics"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T00:56:26.981Z"
completedAt: "2026-02-23T00:56:26.981Z"
description: "Harden refresh behavior when semantic diff inspection fails so users keep prior output and receive machine-readable failure details."
---

## Subtask: Guard cached PR markdown from semantic diff-stage invalidation

**ID:** `12b94a64-3fa2-4777-a4f7-67895699eb48`
**Status:** completed
**Priority:** critical

Prevent refresh from overwriting or clearing the last successful PR markdown artifact when failure occurs specifically during semantic diff inspection, preserving reviewer continuity.

**Acceptance Criteria**

- When semantic diff inspection throws, cached PR markdown content remains unchanged on disk
- Refresh response indicates degraded status and references the preserved cache timestamp
- No empty or partial markdown artifact is written for failed diff-stage refresh attempts

---

## Subtask: Return structured semantic-diff failure payload in refresh API

**ID:** `1d644e01-bbaa-481a-95ef-bea016092865`
**Status:** completed
**Priority:** high

Expose a stable API contract for diff failures so UI and automation can reliably parse error type, failing stage, command context, and remediation metadata.

**Acceptance Criteria**

- Refresh API returns a typed error object with stage set to semantic-diff when diff inspection fails
- Payload includes fields for failing git subcommand, stderr excerpt, and reproducible command list
- Contract is covered by integration tests that validate field presence and schema for semantic-diff failures

---

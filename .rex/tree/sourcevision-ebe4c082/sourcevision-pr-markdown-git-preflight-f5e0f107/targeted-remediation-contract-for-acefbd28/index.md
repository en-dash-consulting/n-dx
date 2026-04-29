---
id: "acefbd28-96c3-40fe-a8fe-0539b9eee1bb"
level: "task"
title: "Targeted Remediation Contract for Preflight Failures"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T02:33:50.106Z"
completedAt: "2026-02-23T02:33:50.106Z"
acceptanceCriteria: []
description: "Return actionable, error-specific remediation guidance so operators can recover quickly without inspecting raw git errors."
---

## Subtask: Define structured preflight error schema with remediation commands

**ID:** `148e5fc6-b111-491f-b285-d9abd7b67329`
**Status:** completed
**Priority:** high

Extend refresh diagnostics contract to include stable failure codes, human-readable cause summaries, and command-ready remediation steps for each classified preflight error.

**Acceptance Criteria**

- API response includes fields for `code`, `summary`, and `remediationCommands` on preflight failure
- Each failure code in scope (`NOT_A_REPO`, `MISSING_BASE_REF`, `FETCH_DENIED`, `NETWORK_DNS_ERROR`, `DETACHED_HEAD`, `SHALLOW_CLONE`) maps to at least one remediation command
- Schema validation fails when a preflight error is returned without remediation commands
- Contract tests verify response shape for all scoped failure codes

---

## Subtask: Replace generic PR markdown refresh git errors with classified preflight output

**ID:** `959b5160-522d-4e65-be1a-858d938a3c33`
**Status:** completed
**Priority:** high

Update refresh endpoint and PR Markdown UI messaging to prefer classified preflight diagnostics and hide low-signal raw git diff failure text.

**Acceptance Criteria**

- When preflight fails, endpoint returns classified diagnostics and skips generic diff error wrapping
- UI renders failure-specific remediation commands and does not display raw git stderr by default
- Existing degraded-mode refresh behavior remains unchanged for non-preflight failures
- Integration tests confirm targeted messaging appears for auth, network, and detached-head cases

---

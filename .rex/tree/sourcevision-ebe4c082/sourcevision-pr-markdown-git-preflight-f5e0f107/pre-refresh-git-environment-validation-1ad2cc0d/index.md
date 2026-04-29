---
id: "1ad2cc0d-78ce-499d-afa5-ecb786523a3e"
level: "task"
title: "Pre-refresh Git Environment Validation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T00:51:29.431Z"
completedAt: "2026-02-23T00:51:29.431Z"
acceptanceCriteria: []
description: "Validate git prerequisites before PR markdown generation so refresh failures are detected early and reported with precise root causes."
---

## Subtask: Implement repository state preflight before PR markdown refresh

**ID:** `6304783a-0e48-4bee-b9f4-82c5f4407ac3`
**Status:** completed
**Priority:** critical

Add a preflight step that verifies the working directory is a git repository and the current HEAD is attached to a branch before any diff or fetch operation runs.

**Acceptance Criteria**

- Refresh flow runs repository-state preflight before invoking diff generation
- When executed outside a git repository, response returns error code `NOT_A_REPO` and does not attempt diff/fetch
- When HEAD is detached, response returns error code `DETACHED_HEAD` and includes current commit SHA in diagnostics
- Unit tests cover success and both failure paths

---

## Subtask: Validate base reference existence and shallow-clone readiness

**ID:** `a4c20a31-3d46-4026-8032-92082153cede`
**Status:** completed
**Priority:** high

Ensure the configured base reference can be resolved locally and handle shallow history limitations before attempting branch comparison.

**Acceptance Criteria**

- Preflight checks whether configured base ref resolves to a valid commit
- If base ref is missing, response returns `MISSING_BASE_REF` with the unresolved ref name
- If repository is shallow and lacks required history, response returns `SHALLOW_CLONE`
- Integration tests simulate missing base ref and shallow clone scenarios with deterministic outcomes

---

## Subtask: Add remote reachability and credential preflight checks

**ID:** `f28aa3d3-61ba-4f72-a180-0ce5d2778756`
**Status:** completed
**Priority:** critical

Proactively test remote connectivity and authentication so fetch-related issues are classified before refresh attempts fail with generic git errors.

**Acceptance Criteria**

- Preflight performs a lightweight remote check against the configured base remote
- Credential failures are classified as `FETCH_DENIED` when remote reports authorization/authentication rejection
- Connectivity failures are classified as `NETWORK_DNS_ERROR` when DNS or transport connection fails
- Refresh aborts before diff generation when remote or credential preflight fails
- Tests cover auth-denied and network/DNS failure classification

---

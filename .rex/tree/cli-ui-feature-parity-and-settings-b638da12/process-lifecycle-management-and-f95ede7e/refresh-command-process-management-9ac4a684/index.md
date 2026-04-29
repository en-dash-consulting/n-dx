---
id: "9ac4a684-2100-4520-868a-b7d33d4818dd"
level: "task"
title: "Refresh Command Process Management"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T07:53:24.020Z"
completedAt: "2026-02-24T07:53:24.020Z"
acceptanceCriteria: []
description: "Enhance the ndx refresh command to properly detect and clean up existing dashboard processes before starting refresh operations"
---

## Subtask: Add pre-refresh process conflict detection and resolution

**ID:** `979b4a53-459b-43e7-98fc-94723f88698f`
**Status:** completed
**Priority:** high

Implement detection of existing dashboard processes during refresh and provide automated cleanup before proceeding with refresh operations

**Acceptance Criteria**

- Existing dashboard processes are detected before refresh starts
- Automated cleanup procedures terminate conflicting processes
- Refresh proceeds only after successful cleanup verification

---

## Subtask: Implement robust port availability checking with retry logic

**ID:** `6192cf7b-0582-40e6-9136-856894ce453c`
**Status:** completed
**Priority:** high

Implemented robust port availability checking with retry logic (commit d955530). Added checkPortWithRetry() to packages/web/src/server/port.ts with configurable exponential backoff (maxRetries, retryDelayMs, backoffFactor). Updated findAvailablePort() to accept optional retryOpts parameter (backward compatible). Wired retry options into startServer() in start.ts (maxRetries=5, retryDelayMs=100, backoffFactor=2) so recently stopped server ports get up to ~3s to clear before fallback. Exported new API from server/index.ts and public.ts. Added 6 new tests covering: immediate success, retry-and-succeed on port release, exhausted retries, maxRetries=0 edge case, findAvailablePort with retryOpts recovering preferred port, and fallback after exhausted retries. All 15 port tests pass. Pre-existing failures noted: sidebar.test.ts (localStorage mock env issue) and routes-hench.ts TS error (killWithFallback import) are both pre-existing.

**Acceptance Criteria**

- Port availability is verified before attempting to bind
- Retry logic handles timing issues during process transitions
- Clear error messages provided when ports remain unavailable

---

## Subtask: Add refresh operation cleanup validation and rollback

**ID:** `64720ae2-dae3-4a2c-b4b8-34d743d7f720`
**Status:** completed
**Priority:** medium

Implement validation procedures that verify successful refresh completion and provide rollback mechanisms for failed refresh attempts

**Acceptance Criteria**

- Refresh success is validated before marking operation complete
- Rollback procedures restore previous state on failure
- Clear status reporting throughout refresh lifecycle

---

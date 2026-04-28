---
id: "39cfec87-52fc-4c7b-bc2c-c6a6581f5138"
level: "task"
title: "PR Markdown UI messaging and regression coverage"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T23:34:13.134Z"
completedAt: "2026-02-22T23:34:13.134Z"
description: "Align UI behavior and tests with degraded refresh responses so users see clear, cause-specific messaging while cached markdown remains available."
---

## Subtask: Render degraded refresh banners with diagnostic-specific messaging

**ID:** `6364d2f6-3c9d-42bf-b9c7-d2396b568aaa`
**Status:** completed
**Priority:** high

Update PR Markdown tab messaging to display targeted degraded-state notices based on diagnostic codes while preserving cached markdown visibility.

**Acceptance Criteria**

- UI shows cached markdown content when refresh response status is degraded
- UI displays diagnostic-specific message variants for all supported codes
- UI does not show generic refresh failure copy for classified degraded responses

---

## Subtask: Surface remediation hints in PR Markdown refresh error panel

**ID:** `d63a5c9b-0819-46be-a233-4ab5450a2430`
**Status:** completed
**Priority:** medium

Expose server-provided remediation hints directly in the PR Markdown tab so users can take immediate recovery actions.

**Acceptance Criteria**

- When degraded response includes remediation hints, UI renders them as a visible actionable list
- Hints are hidden when refresh succeeds or no hints are provided
- Hint rendering is deterministic and preserves server-provided order

---

## Subtask: Add integration tests for degraded refresh API and UI parity

**ID:** `943a20b0-cea4-4177-809e-943fb6f24470`
**Status:** completed
**Priority:** high

Prevent regressions by validating refresh behavior, diagnostics, cache retention, and UI messaging across all targeted failure classes.

**Acceptance Criteria**

- API integration tests cover each classified failure code with cached markdown present and assert non-500 degraded responses
- API tests assert cached markdown payload retention for degraded responses
- UI integration tests assert diagnostic-specific messaging and remediation hint rendering for degraded responses

---

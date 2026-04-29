---
id: "db4a5c69-e833-48de-a0b5-51e69e3f345e"
level: "task"
title: "Endpoint Integration and Diagnostic States"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T06:25:50.658Z"
completedAt: "2026-02-21T06:25:50.658Z"
acceptanceCriteria: []
description: "Ensure PR Markdown data and availability state come from the dedicated APIs with clear, actionable UI feedback for unavailable scenarios."
---

## Subtask: Integrate PR Markdown view with data and state endpoints under a unified refresh loop

**ID:** `df7715a3-333a-48ca-aca7-73720e59a502`
**Status:** completed
**Priority:** critical

Use `/api/sv/pr-markdown` for content and `/api/sv/pr-markdown/state` for availability, with coordinated refresh behavior so UI state and markdown output stay in sync.

**Acceptance Criteria**

- View fetches markdown content from `/api/sv/pr-markdown` and availability metadata from `/api/sv/pr-markdown/state`
- Auto-refresh updates both state and markdown without requiring manual reload
- When state reports unavailable, markdown fetch is skipped or safely handled to avoid repeated error spam

---

## Subtask: Render cause-specific empty and error states with remediation guidance

**ID:** `f3540df8-5c00-40cd-9c6a-4308d193d0f4`
**Status:** completed
**Priority:** critical

Provide explicit messages and fix steps for known unavailability causes so users can self-resolve setup issues quickly.

**Acceptance Criteria**

- UI shows a distinct message for 'not a git repository' with a concrete remediation step
- UI shows a distinct message for 'unresolved base branch' with a concrete remediation step
- UI shows a distinct message for 'wrong server/port or endpoint unreachable' with a concrete remediation step
- Fallback error state handles unknown failures without exposing raw stack traces

---

## Subtask: Add integration tests for PR Markdown tab parity and unavailable-state messaging

**ID:** `11d11e51-e318-4fe3-9871-d13f142fb42d`
**Status:** completed
**Priority:** high

Lock in behavior with end-to-end coverage for tab selection parity, route wiring, endpoint-driven refresh, and user-facing diagnostics.

**Acceptance Criteria**

- Test verifies PR Markdown appears as a SourceVision sidebar tab and can be selected like existing tabs
- Test verifies direct hash navigation to PR Markdown selects the correct tab and view
- Test verifies unavailable-state messages for git repo, base branch, and server/port scenarios
- Test verifies refresh loop updates displayed content when endpoint responses change

---

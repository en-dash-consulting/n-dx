---
id: "e228c8a1-994a-48ae-8f5c-931e7d029c09"
level: "task"
title: "Refresh endpoint degraded response parity"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T23:14:32.541Z"
completedAt: "2026-02-22T23:14:32.541Z"
acceptanceCriteria: []
description: "Make `/api/sv/pr-markdown/refresh` behave consistently with read/state endpoints by returning structured degraded responses when refresh prerequisites fail but cached markdown is available."
---

## Subtask: Implement degraded refresh response contract with cache retention

**ID:** `dc66a2b8-1528-4729-84af-9015bf6db2fc`
**Status:** completed
**Priority:** critical

Ensure refresh returns a non-500 structured payload when generation fails for known git/base-branch conditions and cached markdown exists, so users keep usable output instead of losing access.

**Acceptance Criteria**

- When cached markdown exists and refresh encounters a classified git/base-branch failure, the endpoint responds with HTTP 200 and a `degraded` status instead of HTTP 500
- Response includes cached markdown content and last-refreshed metadata without mutation
- Unhandled/unknown errors still return HTTP 500 with existing error envelope

---

## Subtask: Add refresh failure classifier for git and base-branch resolution errors

**ID:** `0c396566-05c8-46af-86a8-a8b4eedd0995`
**Status:** completed
**Priority:** critical

Classify refresh failures into explicit diagnostic codes so clients can provide precise remediation guidance and avoid generic server-error messaging.

**Acceptance Criteria**

- Classifier emits distinct codes for `missing_git`, `not_repo`, `unresolved_main_or_origin_main`, `fetch_failed`, `rev_parse_failed`, and `diff_failed`
- Each classified code is propagated in refresh response diagnostics when triggered
- Classifier is reused by refresh flow logic rather than duplicating ad-hoc string checks

---

## Subtask: Attach actionable remediation hints to degraded diagnostics

**ID:** `8d9092cb-70b8-4dd9-8dc2-5bdf10c16807`
**Status:** completed
**Priority:** high

Provide operator-ready next steps in refresh responses so users can recover from degraded mode without reading logs or source code.

**Acceptance Criteria**

- Each diagnostic code includes at least one remediation hint tailored to that failure mode
- Hints are present in degraded refresh responses and omitted from successful refresh responses
- Hints for unresolved base branch explicitly reference checking `main` and `origin/main` availability

---

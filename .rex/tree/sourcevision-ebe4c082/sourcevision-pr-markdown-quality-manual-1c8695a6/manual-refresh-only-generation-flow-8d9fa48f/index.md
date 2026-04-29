---
id: "8d9fa48f-fcc1-490a-bf7f-6b0751f8b22f"
level: "task"
title: "Manual Refresh-Only Generation Flow"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T06:57:50.668Z"
completedAt: "2026-02-21T06:57:50.668Z"
acceptanceCriteria: []
description: "Replace automatic refresh behavior with explicit user-triggered regeneration via CLI and UI actions."
---

## Subtask: Add SourceVision CLI command to refresh PR markdown on demand

**ID:** `62d9af46-cf6f-4d2f-b859-04b12727230b`
**Status:** completed
**Priority:** critical

Provide an explicit command entry point so users can regenerate PR markdown only when they choose.

**Acceptance Criteria**

- New CLI command is available under SourceVision to refresh/regenerate PR markdown
- Command exits with code 0 on success and non-zero on generation failure
- Help output documents command purpose, usage, and expected output location

---

## Subtask: Persist generated PR markdown and refresh metadata as cached artifact

**ID:** `7a91065e-0d2e-4e53-9842-86566352a492`
**Status:** completed
**Priority:** critical

Store generated content and metadata (including refresh timestamp and error state) so the UI can display stable results without recomputing.

**Acceptance Criteria**

- Successful refresh writes markdown content and last-refreshed timestamp to cache
- Failed refresh records an error state without deleting last successful content
- Cache read path returns both content and metadata in a single model

---

## Subtask: Remove automatic PR markdown refresh triggers from file and git change watchers

**ID:** `9a3d24c1-a2de-4e8e-820a-e299415fe277`
**Status:** completed
**Priority:** critical

Eliminate background regeneration to make freshness explicit and predictable for users.

**Acceptance Criteria**

- No automatic PR markdown regeneration occurs on file changes
- No automatic PR markdown regeneration occurs on git diff changes
- Integration test confirms output remains unchanged until a manual refresh action is invoked

---

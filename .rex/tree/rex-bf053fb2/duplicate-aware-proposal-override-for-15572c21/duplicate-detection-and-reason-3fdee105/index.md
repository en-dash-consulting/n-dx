---
id: "3fdee105-64b4-4241-b842-67471a34fcc5"
level: "task"
title: "Duplicate Detection and Reason Classification"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T20:56:35.331Z"
completedAt: "2026-02-22T20:56:35.331Z"
description: "Identify when generated add proposals overlap with existing or completed PRD items and produce clear, user-facing duplicate reasons before any write occurs."
---

## Subtask: Implement proposal-to-PRD duplicate matching across open and completed items

**ID:** `6f446893-08d2-4123-85d4-521c41f8f58e`
**Status:** completed
**Priority:** critical

Prevent accidental duplicate creation by comparing generated proposal nodes against current PRD hierarchy, including completed epics/features/tasks that should still be considered duplicates.

**Acceptance Criteria**

- Given a proposal with title/content matching an existing open item, the matcher returns a duplicate result with referenced item id
- Given a proposal matching a completed item, the matcher still returns a duplicate result with completed status context
- Given a proposal with no meaningful overlap, the matcher returns a non-duplicate result and does not block normal flow

---

## Subtask: Attach structured duplicate reasons to generated proposals

**ID:** `df56bcff-a415-4d1d-b533-2ce682e8da29`
**Status:** completed
**Priority:** high

Make override decisions understandable by attaching machine-readable and human-readable reason metadata that explains what matched and why the item is considered duplicate.

**Acceptance Criteria**

- Each duplicate proposal includes reason type, matched item reference, and concise explanation text
- Reason payload distinguishes match context such as exact title match, semantic match, or completed-item match
- Non-duplicate proposals do not include duplicate reason metadata

---

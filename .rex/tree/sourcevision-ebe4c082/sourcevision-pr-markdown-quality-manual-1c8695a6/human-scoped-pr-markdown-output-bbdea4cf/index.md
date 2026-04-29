---
id: "bbdea4cf-7b95-4b36-9f86-d75e1eee6a07"
level: "task"
title: "Human-scoped PR Markdown Output"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T07:05:02.195Z"
completedAt: "2026-02-21T07:05:02.195Z"
acceptanceCriteria: []
description: "Refocus generated PR summaries on reviewer-friendly signal instead of exhaustive file-by-file noise."
---

## Subtask: Redesign PR markdown template around scope, notable changes, and shoutouts

**ID:** `39f4176c-2390-4225-a2cf-2c0430a28bfc`
**Status:** completed
**Priority:** critical

Establish a new output structure that leads with concise scope-of-work and key highlights so reviewers can understand intent quickly.

**Acceptance Criteria**

- Generated markdown includes dedicated sections for Scope of Work, Notable Changes, and Shoutouts
- Section order is consistent across runs
- Template rendering succeeds when one or more sections have no items by showing an explicit fallback line

---

## Subtask: Remove exhaustive per-file change tables from generated markdown

**ID:** `f263e1bb-9e5c-4711-856e-55b143f4f857`
**Status:** completed
**Priority:** critical

Reduce cognitive load by deleting detailed per-file tabular output and replacing it with concise grouped summaries.

**Acceptance Criteria**

- Generated markdown contains no per-file change table blocks
- Summary content is grouped by meaningful themes or workstreams instead of file paths
- Regression test verifies old file-table markers are absent in output

---

## Subtask: Add output quality guardrails for concise section length

**ID:** `4c8b38f4-d480-4a1a-b3cd-f9ff8b2ef7d1`
**Status:** completed
**Priority:** high

Prevent verbose output by enforcing practical limits and fallback behavior when generated sections become too long.

**Acceptance Criteria**

- Each top-level summary section enforces a maximum item count or length limit
- When truncation occurs, markdown includes an explicit note indicating truncation
- Unit tests cover normal, empty, and over-limit section scenarios

---

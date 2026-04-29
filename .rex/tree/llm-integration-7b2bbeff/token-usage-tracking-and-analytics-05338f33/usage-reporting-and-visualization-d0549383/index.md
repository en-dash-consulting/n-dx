---
id: "d0549383-6285-4d0f-bd13-6e171ac9d269"
level: "task"
title: "Usage reporting and visualization"
status: "completed"
source: "smart-add"
startedAt: "2026-02-04T23:32:45.689Z"
completedAt: "2026-02-04T23:32:45.689Z"
acceptanceCriteria: []
description: "Provide comprehensive token usage reports across all n-dx operations"
---

## Subtask: Add token usage to n-dx status command

**ID:** `c0954b48-a8e1-44b3-a379-65314f51dcfa`
**Status:** completed
**Priority:** medium

Show aggregate token usage across all packages in status output

**Acceptance Criteria**

- Status command shows total tokens used
- Breakdown by package (sv/rex/hench) is available
- Time-based filtering options exist

---

## Subtask: Implement dedicated usage reporting command

**ID:** `f656069c-ab55-4e6b-a314-b3aba21bbdb9`
**Status:** completed
**Priority:** medium

Create n-dx usage command for detailed token analytics

**Acceptance Criteria**

- Shows usage by package, command, and time period
- Supports JSON output for scripting
- Includes cost estimation based on model pricing

---

## Subtask: Add usage budget warnings

**ID:** `6a759ce3-8c81-4853-a052-0de115440c9d`
**Status:** completed
**Priority:** low

Warn users when approaching token usage limits

**Acceptance Criteria**

- Configurable budget thresholds
- Warnings displayed during command execution
- Option to abort operations when budget exceeded

---

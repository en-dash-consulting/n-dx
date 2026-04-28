---
id: "47e2c9a4-b85d-498a-b5fa-a9903738ceb7"
level: "task"
title: "Package.json PR Build Script"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T18:01:35.689Z"
completedAt: "2026-02-24T18:01:35.689Z"
description: "Create a comprehensive PR validation script that combines build checking with PRD quality validation"
---

## Subtask: Add pr-check script to package.json with build and PRD validation orchestration

**ID:** `4de2b7fa-471d-4dd0-aa92-d04f688366f3`
**Status:** completed
**Priority:** high

Create a comprehensive PR validation script that runs build checks and Rex PRD validation to prevent broken or incomplete work from being merged

**Acceptance Criteria**

- Script runs `pnpm build` and fails if TypeScript compilation fails
- Script runs `rex validate` and fails if orphaned epics or tasks are detected
- Script exits with proper codes (0 success, 1 failure) for CI integration
- Script provides clear error messages and diagnostics for all failure modes

---

## Subtask: Implement Rex PRD orphan detection for PR validation

**ID:** `ad858840-28a5-4d51-bb79-05dff9b43b6f`
**Status:** completed
**Priority:** high

Extend Rex validation to detect orphaned epics and tasks that would indicate incomplete work being merged

**Acceptance Criteria**

- Detects epics with no child features or tasks
- Detects tasks that are not properly nested under epics or features
- Reports specific orphaned items with IDs, titles, and structural issues
- Integrates with existing rex validate command structure

---

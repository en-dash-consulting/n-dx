---
id: "e30b964c-8f8a-4a66-82f9-58eb481eba41"
level: "task"
title: "File Inventory Enhancement"
status: "completed"
source: "llm"
startedAt: "2026-02-09T15:55:13.442Z"
completedAt: "2026-02-09T15:55:13.442Z"
description: "Comprehensive file classification and metadata extraction"
---

## Subtask: Harden file inventory classification

**ID:** `a89e8e90-e4a3-40f1-a966-118ab58c62a7`
**Status:** completed
**Priority:** low

Improve file language detection, role classification, and structural hashing for accurate inventory results.

**Acceptance Criteria**

- maps .ts to TypeScript
- maps .py to Python
- maps Makefile to Makefile
- maps Dockerfile to Dockerfile
- classifies .test.ts as test
- is independent of zone ID or name (only file groupings matter)

---

## Subtask: Enhance incremental inventory analysis

**ID:** `842e4e87-f444-47d0-b44c-6340f0d339ab`
**Status:** completed
**Priority:** medium

Improve incremental analysis with change detection

**Acceptance Criteria**

- detects changed files by mtime

---

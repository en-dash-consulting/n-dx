---
id: "d5f21901-e34c-4ba2-a265-7a477f013fa5"
level: "task"
title: "Backend Deletion API Implementation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T15:54:29.578Z"
completedAt: "2026-02-24T15:54:29.578Z"
description: "Build complete server-side search infrastructure including API endpoints, indexing system, and query processing with relevance scoring"
---

## Subtask: Audit existing remove functionality in rex codebase

**ID:** `b16f5baa-e899-4933-9b57-edaf57e82cf6`
**Status:** completed
**Priority:** high

Search through rex package source code and CLI commands to identify any existing remove/delete functions for epics and tasks

**Acceptance Criteria**

- Complete scan of rex package reveals all existing deletion functions
- Documentation of current deletion capabilities or confirmation none exist
- Clear assessment of what deletion functionality needs to be implemented

---

## Subtask: Implement remove epic function in rex core

**ID:** `07b70975-a3f3-4863-bd7e-b641052870c8`
**Status:** completed
**Priority:** critical

Create core function to safely remove an epic from the PRD structure, handling child tasks and maintaining data integrity

**Acceptance Criteria**

- Function removes epic and all child features/tasks from PRD tree
- Maintains referential integrity of remaining PRD items
- Returns success/failure status with descriptive error messages
- Validates epic exists before attempting removal

---

## Subtask: Implement remove task function in rex core

**ID:** `9ebe67e0-256a-45f8-97da-a9623ca9e949`
**Status:** completed
**Priority:** critical

Create core function to safely remove individual tasks from the PRD structure while preserving parent-child relationships

**Acceptance Criteria**

- Function removes task from parent feature/epic
- Updates parent completion status if needed
- Handles task dependencies and blocked relationships
- Validates task exists before attempting removal

---

## Subtask: Add deletion commands to rex CLI

**ID:** `7d6fad57-9071-436e-bd37-319a48189b01`
**Status:** completed
**Priority:** high

Expose remove functionality through rex CLI commands with proper validation and confirmation prompts

**Acceptance Criteria**

- rex remove epic <id> command removes specified epic
- rex remove task <id> command removes specified task
- Commands include confirmation prompts for safety
- Commands provide clear success/failure feedback

---

## Subtask: Build complete search backend infrastructure

**ID:** `235cf776-053a-4647-9d0e-1bd5644a7ddc`
**Status:** completed
**Priority:** high

Create comprehensive search system including REST endpoints, searchable index of PRD content, and query processing with relevance scoring for fast text matching across all PRD items

**Acceptance Criteria**

- GET /api/search endpoint accepts query parameter and returns JSON results
- Search results include item ID, title, description, and relevance score
- Response time under 200ms for typical PRD sizes (1000+ items)
- Supports search across epics, features, tasks, and subtasks
- Index includes item titles, descriptions, and acceptance criteria text
- Index updates automatically when PRD items are modified
- Supports fuzzy matching and partial word matching
- Index rebuild completes in under 5 seconds for large PRDs
- Supports exact phrase matching with quotes
- Ranks results by relevance (title matches higher than description)
- Handles multi-word queries with AND/OR logic
- Returns results sorted by relevance score descending

---

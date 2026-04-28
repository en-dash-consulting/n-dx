---
id: "a98b3029-d627-49b6-8578-aa060aa33252"
level: "task"
title: "Claude API token tracking"
status: "completed"
source: "smart-add"
startedAt: "2026-02-04T22:12:08.026Z"
completedAt: "2026-02-04T22:12:08.026Z"
description: "Track and display token consumption from Claude API calls across all packages"
---

## Subtask: Add token tracking to sourcevision analyze command

**ID:** `bb3a012d-48d9-49b5-b76a-cc77da2ca1b8`
**Status:** completed
**Priority:** high

Track tokens used when sourcevision calls Claude for analysis

**Acceptance Criteria**

- Token usage is captured from Claude API responses
- Usage is displayed in analyze output
- Historical usage can be queried

---

## Subtask: Add token tracking to rex analyze command

**ID:** `2f9ec405-a237-4106-8c32-736d3b48f034`
**Status:** completed
**Priority:** high

Track tokens used when rex calls Claude for PRD generation

**Acceptance Criteria**

- Token usage is captured from Claude API responses
- Usage is displayed in analyze output
- Historical usage can be queried

---

## Subtask: Add token tracking to hench runs

**ID:** `5b633358-ed65-403f-9bea-f32cd4cf49d0`
**Status:** completed
**Priority:** high

Track tokens used during autonomous agent execution

**Acceptance Criteria**

- Token usage is captured from all Claude API calls in run
- Usage is stored in run history
- Per-task token breakdown is available

---

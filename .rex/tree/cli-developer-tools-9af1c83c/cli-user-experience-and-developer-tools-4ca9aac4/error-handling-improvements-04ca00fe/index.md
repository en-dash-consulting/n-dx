---
id: "04ca00fe-ef44-4d81-890a-5d8772df540b"
level: "task"
title: "Error handling improvements"
status: "completed"
source: "llm"
startedAt: "2026-02-24T20:33:37.695Z"
completedAt: "2026-02-24T20:33:37.695Z"
acceptanceCriteria: []
description: "Provide clear, actionable error messages instead of technical failures"
---

## Subtask: Replace stack traces with user-friendly errors

**ID:** `3a98fcc1-2af5-4564-baf4-9106a064b331`
**Status:** completed
**Priority:** high

Show actionable error messages instead of raw stack traces

**Acceptance Criteria**

- No stack traces in normal output
- Clear problem descriptions
- Suggested solutions included

---

## Subtask: Add helpful suggestions for missing directories

**ID:** `35e73e67-aa4b-471d-aea1-ac3826ece7f3`
**Status:** completed
**Priority:** medium

Suggest n-dx init when .rex/ doesn't exist

**Acceptance Criteria**

- Detects missing directories
- Suggests initialization command
- Avoids crashes

---

## Subtask: Handle missing claude CLI gracefully

**ID:** `4345197b-c78f-4334-9748-b4a486c0a027`
**Status:** completed
**Priority:** medium

Provide install instructions and fallback when claude CLI not found

**Acceptance Criteria**

- Detects missing claude CLI
- Provides installation instructions
- Graceful fallback behavior

---

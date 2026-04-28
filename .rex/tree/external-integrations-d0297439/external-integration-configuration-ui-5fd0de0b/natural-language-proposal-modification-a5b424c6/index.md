---
id: "a5b424c6-5598-45cc-aa64-1bf986d041ed"
level: "task"
title: "Natural language proposal modification"
status: "completed"
source: "smart-add"
startedAt: "2026-02-18T08:42:14.151Z"
completedAt: "2026-02-18T08:42:14.151Z"
description: "Allow users to provide natural language feedback to modify LLM-generated proposals instead of only accepting/rejecting them"
---

## Subtask: Extend rex add command to accept natural language modification requests

**ID:** `70704abd-fe18-4123-ba17-0c1eeacf4c11`
**Status:** completed
**Priority:** medium

Modify the rex add command's interactive proposal review flow to detect and handle natural language input that requests changes to the generated proposal, rather than just accepting standard control commands (y/n/b1/c1/etc.)

**Acceptance Criteria**

- Command recognizes natural language input during proposal review
- Distinguishes between modification requests and standard control commands
- Maintains backward compatibility with existing y/n/b1/c1 commands

---

## Subtask: Implement proposal modification pipeline with LLM integration

**ID:** `6379a1ad-f280-41ea-af86-e0fcb2a9332d`
**Status:** completed
**Priority:** high

Build the backend pipeline that takes user's natural language modification request, combines it with the original proposal context, and generates a revised proposal using the LLM

**Acceptance Criteria**

- Sends user modification request and original proposal to LLM
- Receives and validates revised proposal structure
- Preserves proposal metadata and hierarchy during modification
- Handles LLM errors gracefully with fallback options

---

## Subtask: Add modification request validation and feedback loop

**ID:** `4e7e3ba2-0a50-4988-b6b4-8979370dae07`
**Status:** completed
**Priority:** medium

Implement validation logic to ensure modification requests are actionable and provide user feedback when requests are ambiguous or cannot be processed

**Acceptance Criteria**

- Validates that modification requests are specific enough to act upon
- Provides helpful error messages for ambiguous requests
- Allows users to refine their modification requests
- Supports iterative refinement until user is satisfied

---

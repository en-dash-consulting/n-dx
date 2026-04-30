---
id: "3e7f193b-6134-47a0-b90c-fc8d0cd262f3"
level: "task"
title: "Update CLI integration tests and add e2e pipeline test for folder-tree PRD commands"
status: "completed"
priority: "high"
tags:
  - "prd"
  - "tests"
  - "integration"
  - "e2e"
source: "smart-add"
startedAt: "2026-04-28T10:06:19.732Z"
completedAt: "2026-04-28T10:19:30.611Z"
endedAt: "2026-04-28T10:19:30.611Z"
acceptanceCriteria:
  - "All rex CLI integration tests pass with folder-tree storage and assert folder structure after each write command"
  - "E2e pipeline test: ndx plan --accept creates folder tree → rex status reads it → rex next selects correct task — all three steps pass"
  - "MCP write-tool integration test asserts folder tree item count and parent summary correctness after each tool call"
  - "Test isolation: every test case uses a fresh temporary directory and cleans up on exit"
  - "No test hardcodes prd.md paths; all tests reference .rex/prd/ folder tree"
description: "Update rex CLI integration tests (add, edit, remove, move, status, next, validate) to assert correct folder-tree state after each command. Add an e2e test that runs the full ndx plan --accept → folder tree → rex status pipeline and asserts folder tree consistency. All test cases must use temporary directories and clean up after themselves."
---

# Update CLI integration tests and add e2e pipeline test for folder-tree PRD commands

🟠 [completed]

## Summary

Update rex CLI integration tests (add, edit, remove, move, status, next, validate) to assert correct folder-tree state after each command. Add an e2e test that runs the full ndx plan --accept → folder tree → rex status pipeline and asserts folder tree consistency. All test cases must use temporary directories and clean up after themselves.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** prd, tests, integration, e2e
- **Level:** task
- **Started:** 2026-04-28T10:06:19.732Z
- **Completed:** 2026-04-28T10:19:30.611Z
- **Duration:** 13m

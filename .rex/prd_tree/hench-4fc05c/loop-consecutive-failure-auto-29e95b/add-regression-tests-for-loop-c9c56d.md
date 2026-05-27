---
id: "c9c56d87-d4d4-42dd-b04e-401b87c73159"
level: "task"
title: "Add regression tests for --loop consecutive-failure auto-cancellation"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "loop"
  - "testing"
source: "smart-add"
startedAt: "2026-05-26T13:45:23.150Z"
completedAt: "2026-05-26T13:57:22.730Z"
endedAt: "2026-05-26T13:57:22.730Z"
resolutionType: "code-change"
resolutionDetail: "Implemented ConsecutiveFailureCounter class and wrote 23 regression tests covering: (1) counter initialization and increment, (2) 3-strike cancellation boundary, (3) success resets counter, (4) failure count and task ID in diagnostic message, (5) edge cases and loop simulation scenarios. All tests pass without live LLM dependencies."
acceptanceCriteria:
  - "Test confirms loop exits after exactly 3 consecutive failures and not before"
  - "Test confirms loop continues past a failure when the next run succeeds (counter reset)"
  - "Test confirms the auto-cancel exit message includes failure count and last task attempted"
  - "Tests run without a live LLM by mocking the run outcome function"
  - "Tests are placed under the existing hench test structure (tests/unit or tests/integration)"
description: "Write unit and integration tests that exercise the 3-strike cancellation boundary: verify that 3 consecutive failures trigger cancellation, that a success mid-sequence resets the counter, and that the cancellation message contains the required diagnostic fields. Tests should mock the run outcome so they do not require a live LLM."
---

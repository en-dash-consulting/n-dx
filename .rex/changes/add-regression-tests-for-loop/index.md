---
id: "c9c56d87-d4d4-42dd-b04e-401b87c73159"
type: "change"
title: "Add regression tests for --loop consecutive-failure auto-cancellation"
slug: "add-regression-tests-for-loop"
intent: "Write unit and integration tests that exercise the 3-strike cancellation boundary: verify that 3 consecutive failures trigger cancellation, that a success mid-sequence resets the counter, and that the cancellation message contains the required diagnostic fields. Tests should mock the run outcome so they do not require a live LLM."
acceptanceCriteria:
  - "Test confirms loop exits after exactly 3 consecutive failures and not before"
  - "Test confirms loop continues past a failure when the next run succeeds (counter reset)"
  - "Test confirms the auto-cancel exit message includes failure count and last task attempted"
  - "Tests run without a live LLM by mocking the run outcome function"
  - "Tests are placed under the existing hench test structure (tests/unit or tests/integration)"
touches:
  - "29e95bbb-1741-4d7f-b608-19930e6e05d6"
priority: "high"
tags:
  - "hench"
  - "loop"
  - "testing"
source: "smart-add"
---

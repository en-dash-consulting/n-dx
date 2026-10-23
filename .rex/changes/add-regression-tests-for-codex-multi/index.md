---
id: "c57e4a98-4567-4caa-ad64-1dd6667e7316"
type: "change"
title: "Add regression tests for Codex multi-line 'tokens used' output format"
slug: "add-regression-tests-for-codex-multi"
intent: "Add unit and integration tests that assert the parser correctly extracts token counts from the two-line Codex format. Tests should cover: the nominal two-line case, the legacy same-line case, empty or malformed lines between the label and the count, and whitespace-padded counts. Use the existing Codex fixture infrastructure in hench's test suite."
acceptanceCriteria:
  - "Task status is reset from 'in-progress' to 'pending' when a run exits with failure"
  - "Reset applies only to the specific task that was active at failure time"
  - "Console output confirms the reset: task ID, title, and restored status"
  - "PRD reset occurs regardless of whether --no-rollback suppresses git rollback"
  - "PRD file is persisted atomically after the status reset using the existing file-lock path"
touches:
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
priority: "high"
tags:
  - "hench"
  - "rex"
  - "recovery"
source: "smart-add"
---

---
id: "c57e4a98-4567-4caa-ad64-1dd6667e7316"
level: "task"
title: "Add regression tests for Codex multi-line 'tokens used' output format"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "rex"
  - "recovery"
source: "smart-add"
startedAt: "2026-04-16T15:16:59.565Z"
completedAt: "2026-04-16T21:51:28.054Z"
acceptanceCriteria:
  - "Task status is reset from 'in-progress' to 'pending' when a run exits with failure"
  - "Reset applies only to the specific task that was active at failure time"
  - "Console output confirms the reset: task ID, title, and restored status"
  - "PRD reset occurs regardless of whether --no-rollback suppresses git rollback"
  - "PRD file is persisted atomically after the status reset using the existing file-lock path"
description: "Add unit and integration tests that assert the parser correctly extracts token counts from the two-line Codex format. Tests should cover: the nominal two-line case, the legacy same-line case, empty or malformed lines between the label and the count, and whitespace-padded counts. Use the existing Codex fixture infrastructure in hench's test suite."
---

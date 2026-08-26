---
id: "94cad81d-4c83-4c9f-aac5-e97259687f24"
level: "task"
title: "Add regression coverage for parent-exit cleanup and orphan prevention"
status: "completed"
priority: "high"
tags:
  - "testing"
  - "regression"
  - "cli"
  - "sourcevision"
source: "smart-add"
startedAt: "2026-04-03T14:04:10.569Z"
completedAt: "2026-04-03T14:08:57.865Z"
acceptanceCriteria:
  - "An automated regression test verifies child processes are terminated after a successful `n-dx` run"
  - "An automated regression test verifies child processes are terminated after an erroring `n-dx` run"
  - "An automated regression test verifies child processes are terminated after signal interruption of an active run"
  - "Test assertions explicitly fail if a spawned SourceVision-related process remains alive beyond the configured shutdown timeout"
description: "Create automated coverage that proves `n-dx` does not leave child processes behind after successful runs, failures, or interrupted execution, with emphasis on the SourceVision scenarios currently causing lingering machine load."
---

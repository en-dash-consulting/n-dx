---
id: "4ceadf67-034a-4052-8e0f-af2d9ff097f4"
level: "task"
title: "Git-derived completion gate must recognize API-loop writes"
status: "pending"
priority: "high"
source: "ndx-capture"
startedAt: "2026-09-15T18:12:40.908Z"
acceptanceCriteria:
  - "An API-loop run that writes a tracked file or creates a new file after its baseline is captured is recognized as changed and can complete."
  - "The Gemini, local-model, and livelock integration fixtures exercise the real git-derived completion path with valid, deterministic repository baselines."
  - "A completion claim with no agent work still fails, and .rex/.hench bookkeeping alone is not accepted as meaningful work."
  - "The five CI failures in gemini-tool-loop, local-tool-loop, and livelock-detection are fixed without weakening the completion gate."
  - "Focused Hench tests, Hench typecheck, and the package suite pass; add a patch changeset for @n-dx/hench."
description: "CI run 35000812304 fails five Hench API-loop integration tests after the main merge. Tool-driven writes are rejected as no meaningful change by the git-derived completion gate, even though the fixtures produce real output. Repair the production changed-file and completion-validation path rather than weakening the completion requirement or merely changing test expectations."
lastModified: "2026-09-15T18:31:05.903Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

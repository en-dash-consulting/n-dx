---
id: "4e347dad-facb-4d23-a35d-6c7d19ce2d60"
level: "task"
title: "Hold first Ctrl+C during rollback prompt and require second Ctrl+C to exit"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "cli"
  - "run-loop"
  - "interrupt"
source: "smart-add"
startedAt: "2026-04-29T15:43:32.822Z"
completedAt: "2026-04-29T15:50:48.822Z"
endedAt: "2026-04-29T15:50:48.822Z"
acceptanceCriteria:
  - "First Ctrl+C while the rollback prompt is open does not terminate the process and does not auto-answer the prompt"
  - "A visible hint is printed on first Ctrl+C indicating that a second Ctrl+C will exit"
  - "Second Ctrl+C while the rollback prompt is still open exits the process cleanly without performing rollback"
  - "Behavior applies to both --auto and --loop run modes and to both Claude and Codex vendors"
  - "Regression test covers single-Ctrl+C-during-prompt (held) and double-Ctrl+C-during-prompt (exits) cases"
  - "Ctrl+C behavior outside the rollback prompt window is unchanged"
description: "When a hench run loop is interrupted with Ctrl+C, the existing flow opens a 'Revert n uncommitted file(s)?' rollback prompt. Currently a second Ctrl+C while that prompt is open can drop the user into an inconsistent state. Make the prompt absorb the first interrupt signal so the user can deliberate, and only exit the process when a second Ctrl+C is received while the prompt is still open. The first Ctrl+C should display a hint that pressing Ctrl+C again will abort the rollback prompt and exit."
---

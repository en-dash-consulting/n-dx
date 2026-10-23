---
id: "6dc86135-1fe7-4570-8988-cf66af659f85"
type: "change"
title: "Show rollback prompt on Ctrl+C cancellation and reset PRD task status"
slug: "show-rollback-prompt-on-ctrl-c"
intent: "After the agent loop exits due to a Ctrl+C cancellation, invoke the same rollback prompt flow that already exists for failed runs. If the user confirms, revert all git-tracked file changes made during the run and reset the PRD task status back to its pre-run value (e.g. 'pending'). If the user declines, leave changes in place and mark the task status appropriately (e.g. 'in_progress' or 'pending'). This reuses the existing rollback infrastructure — the goal is to route the cancellation path through it."
acceptanceCriteria:
  - "After Ctrl+C cancellation, the terminal displays the rollback confirmation prompt (same prompt shown on run failure)"
  - "If the user confirms rollback: all file changes introduced during the run are reverted via git, and the PRD task status is reset to its pre-run state"
  - "If the user declines rollback: file changes are preserved and the task is left in a non-completed state with a terminal message explaining how to resume"
  - "PRD task status is never left as 'in_progress' after a cancelled run regardless of rollback choice"
  - "Rollback on cancellation is covered by at least one regression test that simulates SIGINT mid-run"
touches:
  - "626d40cf-4513-4cb1-a767-0aabd05a5f7c"
priority: "high"
tags:
  - "hench"
  - "rollback"
  - "ux"
  - "prd"
source: "smart-add"
---

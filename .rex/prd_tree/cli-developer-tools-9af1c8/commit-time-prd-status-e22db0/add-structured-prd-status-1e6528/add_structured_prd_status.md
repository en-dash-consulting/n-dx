---
id: "1e652885-f8f6-46b1-8fdc-f7ab1cc9b050"
level: "task"
title: "Add structured PRD status transition trailer to commit messages"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "commit"
  - "prd"
  - "pr-markdown"
source: "smart-add"
startedAt: "2026-04-29T18:55:13.022Z"
completedAt: "2026-04-29T19:02:57.258Z"
endedAt: "2026-04-29T19:02:57.258Z"
resolutionType: "code-change"
resolutionDetail: "Implemented N-DX-Status trailer in commit messages. When hench completes a task, commits now include a machine-readable trailer (e.g., N-DX-Status: task-1 in_progress → completed) recording the PRD status transition. Enables downstream tooling to reconstruct PRD progress from git history. Added integration test verifying trailer is properly formatted and git-readable. Fixes pre-existing TypeScript error in execStdout call."
acceptanceCriteria:
  - "Each hench commit that closes a task includes an `N-DX-Status:` trailer with the PRD item id and the from/to status"
  - "Trailer format is parseable by `git interpret-trailers --parse` and round-trips through `git log --format='%(trailers)'`"
  - "PR markdown generator surfaces the closed PRD items by reading `N-DX-Status:` trailers from the branch's commit range — covered by an integration test against a fixture branch"
  - "Trailer is omitted when the run produces no status change (e.g. partial commits, exploratory edits)"
description: "Add a machine-readable `N-DX-Status:` trailer (e.g. `N-DX-Status: <itemId> pending → completed`) to commits produced by hench. This makes the status transition queryable from `git log` without parsing the diff and lets downstream tooling (PR markdown generator, dashboard timeline) reconstruct PRD progress directly from commit history."
---

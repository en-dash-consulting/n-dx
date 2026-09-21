---
id: "459aabf9-e7b8-49f4-b013-3c6c34aa77c0"
level: "task"
title: "Capture worktreeRoot and branch at run start and refuse automatic commits when they no longer match"
status: "completed"
priority: "critical"
tags:
  - "pr-02"
  - "hench"
blockedBy:
  - "811cf124-3b65-4623-b72f-bfc000229d6a"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T11:50:49.516Z"
completedAt: "2026-09-11T12:05:56.763Z"
endedAt: "2026-09-11T12:05:56.763Z"
acceptanceCriteria:
  - "Run records written to .hench/runs include worktreeRoot, branch and startHead."
  - "Each of the four commit sites checks branch and worktree root first and refuses on mismatch with a message naming both values."
  - "Happy path unchanged: a run that stays on its branch commits as today (existing tests still pass)."
description: "At run start (packages/hench/src/cli/commands/run.ts near performPreRunCommitGateIfNeeded, ~line 1409) capture { worktreeRoot, branch, head } via the gateway helpers and store them on the RunRecord (new optional fields worktreeRoot, branch, startHead in packages/hench/src/schema/v1.ts; additive, old records load unchanged). Before EACH automatic commit (pre-run gate commit and completion-metadata commit in agent/lifecycle/shared.ts, the commit-message watcher commit in commit-msg-watcher.ts, the review-repair commit in agent/analysis/review-repairs.ts) re-read branch and worktree root and compare with realpath-resolved paths; on mismatch do not commit, report a message naming expected vs actual, and leave the tree untouched. Detached HEAD counts as a mismatch unless the run started detached at the same commit. Preserve each call site's existing convention for fatal vs reported failures."
lastModified: "2026-09-11T12:05:56.771Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

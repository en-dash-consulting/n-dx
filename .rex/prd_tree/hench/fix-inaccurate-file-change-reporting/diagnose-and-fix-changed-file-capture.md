---
id: "dd9a6c51-116a-4497-842c-df4640507902"
level: "task"
title: "Diagnose and fix changed-file capture so run records reflect actual commit diffs"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "telemetry"
  - "git"
source: "smart-add"
startedAt: "2026-04-30T20:06:32.352Z"
completedAt: "2026-04-30T20:17:58.322Z"
endedAt: "2026-04-30T20:17:58.322Z"
resolutionType: "code-change"
resolutionDetail: "Created git-changed-files module with deterministic post-commit capture using git show --name-status. Integrated into performCommitPromptIfNeeded to capture exact files from commit SHAs. Added fileChangesWithStatus field to RunSummaryData schema. Comprehensive test coverage: 13 unit tests + 5 integration tests verifying single/multi-commit scenarios with all change types (add, modify, delete) against git output."
acceptanceCriteria:
  - "Run record includes the exact set of files modified by commits attributable to that run, verified against git diff-tree against the run's commit SHA(s)"
  - "Capture is anchored to commit SHAs created during the run rather than to a working-tree snapshot, removing race conditions with staging/commit"
  - "Multi-commit runs aggregate file changes across all run-owned commits without duplication"
  - "Renames, deletions, and additions are each represented with their git status code (A/M/D/R)"
  - "Regression test creates a hench run that touches at least three files (add, modify, delete) and asserts the run record's changed-file list matches git output exactly"
description: "Trace the changed-files capture path end to end: the git command invoked, the working directory, the timing relative to staging/commit, and how results are persisted into the run record. Replace whatever capture currently produces empty results with a deterministic post-commit diff (e.g. git diff-tree --no-commit-id --name-status against the run's commit SHA) so the recorded file list matches the commit. Cover both single-commit and multi-commit runs."
---

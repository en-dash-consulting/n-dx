---
id: "3ff76104-6bf5-49a2-a4d3-66d86f900963"
level: "task"
title: "Post-review full-suite gate skips because filesChanged misses executor and reviewer modifications"
status: "pending"
priority: "medium"
tags:
  - "hench"
  - "review-pass"
  - "test-gate"
source: "ndx-work-e2e-verification"
acceptanceCriteria:
  - "filesChanged is derived from observed tool calls or a git diff against the pre-run baseline, not solely from the model-reported summary"
  - "Files modified by the review pass are included in the gate's filesChanged"
  - "A run in which only the reviewer modified files executes the full test suite gate"
  - "Run records report accurate filesChanged counts for runs with structured tool calls"
description: "runTestGate skips when filesChanged is empty (packages/hench/src/tools/test-runner.ts:573-580). filesChanged is taken from the executor's model-reported structured summary (shared.ts:1729), which can be empty even when tool calls wrote files, and the git-diff fallback only runs when run.toolCalls.length === 0 (shared.ts:1901) — never for Claude CLI runs, which always record tool calls. Review-pass repairs are additionally invisible to it: they happen in a separate spawn after the summary is parsed. Observed end-to-end in run 4b4526c5: the executor wrote 2 files and the reviewer edited 4, yet the gate printed 'Skipped: No files modified in prior phases' and the run record says Changes: none. The full-suite gate is skipped exactly when the reviewer changed code — the situation it exists to protect."
lastModified: "2026-08-28T18:23:47.846Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

---
id: "c971145e-b355-4f67-9fcb-dd37933aec1d"
level: "task"
title: "Don't skip the full test suite gate when the agent has already committed its work"
status: "completed"
priority: "medium"
tags:
  - "review-pass"
  - "e2e-finding"
  - "severity:medium"
blockedBy:
  - "976d34af-75f4-4fe3-bd74-15afed3413e9"
source: "ndx-capture"
startedAt: "2026-08-31T15:33:48.311Z"
completedAt: "2026-08-31T15:46:38.468Z"
endedAt: "2026-08-31T15:46:38.468Z"
resolutionType: "code-change"
resolutionDetail: "Fixed git discovery in finalizeRun to run unconditionally using startingHead; fixed run summary Changes line to use structuredSummary.filesChanged; added regression tests for both committed-tree and staged cases"
acceptanceCriteria:
  - "A run whose changes were committed by the agent still executes the full test suite gate"
  - "The gate determines \"files modified\" against the run's startingHead rather than only uncommitted changes"
  - "The run summary's \"Changes\" line reflects files changed since startingHead, not just uncommitted ones"
  - "A regression test covers the committed-tree case"
description: "Run 60c3a951 printed:\n\n    ── Full Test Suite Gate ────────────\n               Skipped: No files modified in prior phases\n\nand \"Changes: none\" in the run summary — even though the run did change packages/llm-client/src/config.ts and its tests. The gate keys off uncommitted working-tree changes, and the executor had already committed them, so hench saw a clean tree and concluded nothing had been modified.\n\nThe effect is that a run which modified source shipped without hench's own full-suite gate ever executing. The reviewer noticed independently and ran `npm run test` itself, which is how the two red web tests surfaced at all — but that was the reviewer's initiative, not the gate doing its job.\n\nShares a root cause with the review-ordering defect (executor self-commit), so it may be fixed by the same change; keeping it separate because the gate should arguably be robust to a committed tree regardless — comparing against the run's startingHead rather than the working tree would make it so.\n\n---\n\nREPRODUCED under a DIFFERENT cause, run ea962353 (2026-08-28, e2e verification of --review, task 0deece15). The self-commit explanation above does not cover this case:\n\n- The executor did NOT commit. HEAD stayed at 62159d22 for the whole run; the commit (6048bc6) came from performCommitPromptIfNeeded at the end, exactly as designed.\n- The tree was not clean at gate time — 8 files were staged.\n- 21 tool calls were recorded (so the `run.toolCalls.length === 0` git fallback at shared.ts:1997-2015 did not fire), including 5 Edits and a Write.\n- The gate still printed \"Skipped: No files modified in prior phases\", and the summary still printed \"Changes: none\".\n\nThe real gate input is `run.structuredSummary.filesChanged` (shared.ts:2059), which was empty when runTestGate ran. The persisted record ends with all 8 paths in filesChanged — but they were backfilled after the commit by the attribution step (\"Captured 8 file change(s) from commit 6048bc6\"), too late for the gate. The sibling counts in the same record are also zero against a run that plainly read files and ran commands: `{filesRead: 0, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 21}`.\n\nSo the defect is broader than \"the executor committed first\": structuredSummary.filesChanged is empty at gate time on an ordinary uncommitted run, and the git fallback is gated on there being no tool calls at all — the one case where it cannot help. Deriving filesChanged from `git diff --name-only HEAD` (plus staged) unconditionally before the gate, rather than only when toolCalls is empty, would fix both reported cases. Whatever the fix, the regression test should cover the uncommitted-tree case as well as the committed-tree case named in the criteria."
lastModified: "2026-08-31T15:46:38.491Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

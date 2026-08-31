---
id: "5f791a91-3762-4d3a-b0b4-e787ee9fbc1e"
level: "task"
title: "Full test suite gate still skips with \"No files modified in prior phases\" after the c971145e fix"
status: "pending"
priority: "high"
tags:
  - "review-pass"
  - "e2e-finding"
  - "severity:high"
  - "test-gate"
source: "ndx-capture"
acceptanceCriteria:
  - "A run that stages source and test files executes the full test suite gate rather than skipping it"
  - "structuredSummary.counts reflects the run's actual tool calls (filesRead/commandsExecuted/testsRun non-zero when those tools were used) at gate time, not only after the post-commit backfill"
  - "A failure inside the git-discovery block at shared.ts:2053-2092 is surfaced rather than silently swallowed into a skipped gate"
  - "A regression test covers the staged-but-uncommitted tree case with a non-empty tool-call list"
  - "Verified by a live ndx work --review run, not only by unit test"
description: "Third reproduction of the c971145e symptom — and the first one AFTER c971145e was marked completed (2026-08-31T15:46Z, \"Fixed git discovery in finalizeRun to run unconditionally using startingHead\"). The fix does not hold.\n\nEvidence: live run a4197298-18f1-4179-bb00-05655d4a650e in the throwaway project `.local_testing/ndx-verify-mustfix` (2026-08-31T18:57Z, claude-sonnet-5, `ndx work --task=11223344-... --review --review-model=claude-sonnet-5 --yes`), the run that verified task f29a5567.\n\nThe gate printed:\n\n    ── Full Test Suite Gate ────────────\n               Skipped: No files modified in prior phases\n\non a run that committed 10 files, including `src/utils.js` and `test/utils.test.js`. This is not the committed-tree case from the original report: HEAD stayed at 7c702c0 for the whole run and the commit (e39e5f5) came from performCommitPromptIfNeeded. At gate time the tree was NOT clean — the executor had run `git add -A` and the review pass had just restaged 2 more files (\"Staged 2 file(s) modified by the review pass.\" appears immediately above the gate banner in the run log).\n\nPersisted record state:\n- `testGate: {\"ran\":false,\"passed\":true,\"packages\":[],\"skipReason\":\"No files modified in prior phases\"}`\n- `structuredSummary.counts: {\"filesRead\":0,\"filesChanged\":10,\"commandsExecuted\":0,\"testsRun\":0,\"toolCallsTotal\":19}` — filesChanged 10 is the POST-COMMIT backfill (\"Captured 10 file change(s) from commit e39e5f5\"); filesRead/commandsExecuted/testsRun are zero against 19 recorded tool calls that include Bash, Read, Write and Edit.\n- `toolCalls` has 19 entries keyed `tool` (not `name`), and summary.ts:48 switches on `call.tool`, so the key is right — yet every derived count is zero. Whatever populates structuredSummary is running before toolCalls is filled, or against a different array.\n\nSo `run.structuredSummary.filesChanged` was empty when runTestGate read it (test-runner.ts:573 skips only on `filesChanged.length === 0`), despite the unconditional git discovery added for c971145e at shared.ts:2053-2092, which merges `git diff --name-only --cached` — a query that could not have returned empty with files staged. Either that block threw and was swallowed by the bare `catch` at shared.ts:2088 (whose own comment predicts exactly this outcome: \"The gate may skip if it remains empty\"), or it does not run before the gate on this path.\n\nEffect: the gate that is documented as mandatory before commit did not execute on a run that shipped source and tests. As in the previous two reproductions, the only reason the suite ran at all was the reviewer's own initiative (it ran `node --test` itself and reported 8/8).\n\nSuggested next step: make the swallowed failure observable before fixing the cause — the bare catch converts a broken gate into a silent pass, which is why this has now been \"fixed\" once and reproduced twice. A gate that cannot determine what changed should fail loudly or run the suite anyway, not skip."
lastModified: "2026-08-31T19:05:06.709Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

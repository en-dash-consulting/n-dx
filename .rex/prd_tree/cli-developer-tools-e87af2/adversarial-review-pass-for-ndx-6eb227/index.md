---
id: "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
level: "feature"
title: "Adversarial review pass for ndx work (--review)"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "After a task's changes pass completion validation and before the commit prompt, a second agent attacks the change, triages each finding for severity and necessity, repairs must-fix findings in-session, and captures the rest to the PRD. On the Claude CLI the reviewer resumes the work session on a stronger model so it inherits the implementation context; other vendors get a fresh reviewer. Taking the --review flag moves the existing interactive diff-approval gate to --approve-diff."
lastModified: "2026-08-26T04:37:26.277Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A failed run leaves the PRD claiming success when the agent self-marked the task completed](./a-failed-run-leaves-the-prd-a5e8c5.md) | completed |
| [Add --review flag and move the diff-approval gate to --approve-diff](./add-review-flag-and-move-the-f7a55c.md) | completed |
| [Break token figures into fresh/cache/output in the run summary and hench record](./break-token-figures-into-fresh-0ba847.md) | pending |
| [captureFailedFindings mislabels a must-fix whose own repair attempt failed as a capture failure](./capturefailedfindings-mislabels-0c5870.md) | pending |
| [Commit-message watcher auto-commits mid-review, splitting or dropping the reviewer's repairs](./commit-message-watcher-auto-8b7df3.md) | completed |
| [commitWatcher.cancel() cannot stop an auto-commit already in flight, so the review-pass suspension has a silent hole](./commitwatcher-cancel-cannot-63cbcc.md) | pending |
| [Correct the remaining stale entries in MODEL_COSTS](./correct-the-remaining-stale-859237.md) | completed |
| [Don't skip the full test suite gate when the agent has already committed its work](./don-t-skip-the-full-test-suite-c97114.md) | pending |
| [Give review its own model tier with a review-model override](./give-review-its-own-model-tier-b889a2.md) | completed |
| [Grant the reviewer PRD-write permission so findings can be captured in non-interactive runs](./grant-the-reviewer-prd-write-120b14.md) | completed |
| [Resume the work session for the reviewer on --resume](./resume-the-work-session-for-the-2eb560.md) | completed |
| [--review leaves the PRD completion metadata uncommitted when the agent commits its own work anyway](./review-leaves-the-prd-544d93.md) | completed |
| [Review report transport, parsing, and run-record recording](./review-report-transport-parsing-2f0be1.md) | completed |
| [Reviewer repairs join the run's commit only if the reviewer voluntarily stages them](./reviewer-repairs-join-the-run-s-e168b8.md) | completed |
| [run --help promises reviewer MCP capture grants unconditionally, but extraAllowedTools is Claude-only](./run-help-promises-reviewer-mcp-f6a94c.md) | pending |
| [Run the review pass before the executor's own commit, not after it](./run-the-review-pass-before-the-976d34.md) | completed |
| [Stop labeling every unresolved finding as must-fix in the review warning](./stop-labeling-every-unresolved-8c5cc2.md) | completed |
| [The "keeps the quiet acknowledgment" test asserts nothing about the acknowledgment it names](./the-keeps-the-quiet-234090.md) | pending |
| [Verified: the executor needs no rex MCP grants — its PRD writes are in-process](./verified-the-executor-needs-no-bd3459.md) | completed |
| [Verify a reviewer must-fix repair reaches the run's commit on a live run](./verify-a-reviewer-must-fix-f29a55.md) | pending |
| [Verify the review pass end-to-end against a real ndx work run](./verify-the-review-pass-end-to-0deece.md) | completed |

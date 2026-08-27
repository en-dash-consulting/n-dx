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
| [A failed run leaves the PRD claiming success when the agent self-marked the task completed](./a-failed-run-leaves-the-prd-a5e8c5.md) | pending |
| [Add --review flag and move the diff-approval gate to --approve-diff](./add-review-flag-and-move-the-f7a55c.md) | completed |
| [Break token figures into fresh/cache/output in the run summary and hench record](./break-token-figures-into-fresh-0ba847.md) | pending |
| [Correct the remaining stale entries in MODEL_COSTS](./correct-the-remaining-stale-859237.md) | completed |
| [Don't skip the full test suite gate when the agent has already committed its work](./don-t-skip-the-full-test-suite-c97114.md) | pending |
| [Give review its own model tier with a review-model override](./give-review-its-own-model-tier-b889a2.md) | completed |
| [Grant the reviewer PRD-write permission so findings can be captured in non-interactive runs](./grant-the-reviewer-prd-write-120b14.md) | completed |
| [Resume the work session for the reviewer on --resume](./resume-the-work-session-for-the-2eb560.md) | completed |
| [Review report transport, parsing, and run-record recording](./review-report-transport-parsing-2f0be1.md) | completed |
| [Run the review pass before the executor's own commit, not after it](./run-the-review-pass-before-the-976d34.md) | completed |
| [Stop labeling every unresolved finding as must-fix in the review warning](./stop-labeling-every-unresolved-8c5cc2.md) | pending |
| [Verified: the executor needs no rex MCP grants — its PRD writes are in-process](./verified-the-executor-needs-no-bd3459.md) | completed |
| [Verify the review pass end-to-end against a real ndx work run](./verify-the-review-pass-end-to-0deece.md) | pending |

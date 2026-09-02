---
id: "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
level: "feature"
title: "Adversarial review pass for ndx work (--review)"
status: "completed"
priority: "high"
startedAt: "2026-08-31T19:37:13.157Z"
completedAt: "2026-08-31T19:37:13.157Z"
endedAt: "2026-08-31T19:37:13.157Z"
acceptanceCriteria: []
description: "After a task's changes pass completion validation and before the commit prompt, a second agent attacks the change, triages each finding for severity and necessity, repairs must-fix findings in-session, and captures the rest to the PRD. On the Claude CLI the reviewer resumes the work session on a stronger model so it inherits the implementation context; other vendors get a fresh reviewer. Taking the --review flag moves the existing interactive diff-approval gate to --approve-diff."
lastModified: "2026-08-31T19:37:13.164Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add .hench/reviews/ to .gitignore](./add-hench-reviews-to-gitignore.md) | completed |
| [Add --review flag and move the diff-approval gate to --approve-diff](./add-review-flag-and-move-the-f7a55c.md) | completed |
| [autoCommit leaves reviewer must-fix repairs uncommitted when the executor self-commits](./autocommit-leaves-reviewer-must-0e5993.md) | completed |
| [Correct the remaining stale entries in MODEL_COSTS](./correct-the-remaining-stale-859237.md) | completed |
| [Give review its own model tier with a review-model override](./give-review-its-own-model-tier-b889a2.md) | completed |
| [Post-review full-suite gate skips because filesChanged misses executor and reviewer modifications](./post-review-full-suite-gate-3ff761.md) | completed |
| [Resume the work session for the reviewer on --resume](./resume-the-work-session-for-the-2eb560.md) | completed |
| [Review report transport, parsing, and run-record recording](./review-report-transport-parsing-2f0be1.md) | completed |
| [Unresolved-findings warning mislabels non-must-fix failures as unrepaired must-fix](./unresolved-findings-warning-377d09.md) | completed |
| [Verify the review pass end-to-end against a real ndx work run](./verify-the-review-pass-end-to-0deece.md) | completed |

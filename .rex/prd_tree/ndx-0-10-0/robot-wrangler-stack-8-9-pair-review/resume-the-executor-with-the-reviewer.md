---
id: "63f5fbf5-5991-4b9b-b1e2-dee981be4d4c"
level: "task"
title: "Resume the executor with the reviewer's must-fix findings and re-review, up to hench.review.rounds"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-8"
blockedBy:
  - "21c9901f-3b7d-4e60-a0d1-a32e1693ee07"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "With a stub reviewer that reports one must-fix finding then passes, the executor is resumed once, tests re-run, the reviewer re-checks and the task completes (integration test with stub CLIs)."
  - "With a reviewer that never passes and rounds 2, the executor is resumed twice and the task fails review with the findings captured."
  - "Should-fix findings never block the commit."
  - "Each round is recorded on the run record."
  - "`pnpm --filter @n-dx/hench test` and the package typecheck pass."
description: "After a pair-mode review report:\n\n1. **No must-fix findings:** proceed to commit, capturing should-fix and lower findings to the PRD (existing capture path).\n2. **Must-fix findings:** resume the executor's own session (`--resume <session-id>`, as the self review already does) with a prompt listing each must-fix finding: file, failure trigger, expected behaviour. Ask it to fix them and nothing else.\n3. Re-run the task's validation (tests).\n4. Spawn the reviewer again, fresh, with the new diff and the previous round's findings. Ask it to confirm each finding is fixed and to report anything new.\n5. Repeat for up to `hench.review.rounds` (default 2) fix rounds.\n\nIf must-fix findings remain after the last round, the review fails: the task is not completed (use the existing failed-review handling) and the remaining findings are captured.\n\nRecord each round on the run record: findings in, findings fixed, and the reviewer verdict."
lastModified: "2026-10-10T23:41:30.990Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

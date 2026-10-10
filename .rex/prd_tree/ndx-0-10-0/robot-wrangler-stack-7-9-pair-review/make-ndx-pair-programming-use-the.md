---
id: "1344521b-545a-46b1-acff-d13305f869dd"
level: "task"
title: "Make ndx pair-programming use the configured reviewer vendor, reviewer model and fix rounds"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-7"
blockedBy:
  - "d2d48473-3e07-4ec5-b167-6ba0bd370be2"
  - "33f281fb-22ab-4f2f-bf3b-973f7dee61be"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "With hench.review.vendor codex and llm.codex.reviewModel set, the reviewer spawn uses codex with --model set (unit test on the built argv)."
  - "With rounds 2 and a failing first review, the primary gets two remediation passes at most, then the final verdict."
  - "An invalid hench.review.vendor (same as primary) falls back to the default reviewer with a warning."
  - "`pnpm --filter @n-dx/core test` passes."
description: "In `packages/core/pair-programming.js` and `handlePairProgramming` in `packages/core/cli.js`:\n\n- **Reviewer vendor:** take it from `hench.review.vendor` when set and valid (claude or codex, not the primary vendor). Otherwise keep `resolveReviewerVendor`'s current default.\n- **Reviewer model:** pass `llm.<reviewer>.reviewModel` (then `llm.reviewModel`) to the reviewer CLI. Omit it to keep the CLI's default.\n- **Rounds:** replace the single remediation pass with a loop of up to `hench.review.rounds` (default 2) review → remediation cycles, stopping early when the review passes, then a final verdict.\n\nThe orchestration tier reads these through `config.js`, as it already does for other settings; it imports nothing from packages. Print which reviewer and model each round used."
lastModified: "2026-10-10T23:41:20.834Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

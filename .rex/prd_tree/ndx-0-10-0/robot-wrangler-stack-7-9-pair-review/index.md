---
id: "90d68335-0c86-4ed3-a227-b44e22a03161"
level: "feature"
title: "Robot Wrangler stack 7/9 · Pair review: configurable reviewer and cross-vendor findings"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-7"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "`ndx pair-programming` uses hench.review.vendor, llm.<reviewer>.reviewModel and hench.review.rounds."
  - "`ndx work` in pair mode spawns the other vendor's CLI as the reviewer and parses its report."
description: "Pair review is where one vendor executes a task and a different vendor reviews it before the executor fixes the must-fix findings. Today `ndx pair-programming` hard-wires the reviewer (Claude reviews Codex and Codex reviews Claude) on the CLI's default model, and `ndx work --review` only ever reviews with the executor's own vendor.\n\nThis PR does two things:\n- makes `pair-programming` use the configured reviewer vendor, model and rounds;\n- teaches hench's review pass to have the other vendor review the diff and write the structured findings report.\n\nThis is PR 7 of the 9-PR Robot Wrangler stack. Pair review needs a CLI on both sides, which today means Claude and Codex.\n\nGoal: With hench.review.mode pair, a different vendor reviews each task and its findings are reported."
lastModified: "2026-10-10T23:41:17.367Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Have the other vendor review the diff and write the findings report when the review pass runs in pair mode](./have-the-other-vendor-review-the-diff.md) | pending |
| [Make ndx pair-programming use the configured reviewer vendor, reviewer model and fix rounds](./make-ndx-pair-programming-use-the.md) | pending |

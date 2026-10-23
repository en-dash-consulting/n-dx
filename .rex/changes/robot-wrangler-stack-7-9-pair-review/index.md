---
id: "90d68335-0c86-4ed3-a227-b44e22a03161"
type: "change"
title: "Robot Wrangler stack 7/9 · Pair review: configurable reviewer and cross-vendor findings"
slug: "robot-wrangler-stack-7-9-pair-review"
intent: "Pair review is where one vendor executes a task and a different vendor reviews it before the executor fixes the must-fix findings. Today `ndx pair-programming` hard-wires the reviewer (Claude reviews Codex and Codex reviews Claude) on the CLI's default model, and `ndx work --review` only ever reviews with the executor's own vendor.\n\nThis PR does two things:\n- makes `pair-programming` use the configured reviewer vendor, model and rounds;\n- teaches hench's review pass to have the other vendor review the diff and write the structured findings report.\n\nThis is PR 7 of the 9-PR Robot Wrangler stack. Pair review needs a CLI on both sides, which today means Claude and Codex.\n\nGoal: With hench.review.mode pair, a different vendor reviews each task and its findings are reported."
acceptanceCriteria:
  - "`ndx pair-programming` uses hench.review.vendor, llm.<reviewer>.reviewModel and hench.review.rounds."
  - "`ndx work` in pair mode spawns the other vendor's CLI as the reviewer and parses its report."
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
plannedRelease: "0.10.0"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-7"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
---

---
id: "716b508b-63e4-4bb3-b83a-80f107065f82"
level: "task"
title: "Add the Review section: Off, Self review and Pair review, with reviewer vendor, model and fix rounds"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
blockedBy:
  - "2c7d8e17-2fe7-4352-bfe5-2df086c54e3c"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "Off and Self save hench.review.mode and work end to end; Pair is disabled with Coming soon while pairSupported is false."
  - "Reviewer vendor chips disable the executor, Gemini and Local with the stated reasons."
  - "The flow strip reflects the chosen mode, vendors, models and rounds."
  - "With llm.vendor google the section shows the unavailable reason and no mode can be chosen."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "**Section 5, \"Review\"** (subtitle \"A second model checks each task before it commits\"), built from the server's `review` block.\n\n**Mode cards** (a radiogroup):\n- **Off:** \"Commit once the tests pass.\"\n- **Self review:** \"<Vendor> re-reads its own work on a stronger model and fixes what it finds.\"\n- **Pair review**, with a \"Pair\" badge: \"Another vendor reviews. <Vendor> fixes the must-fix findings, then the reviewer checks again.\"\n- While `pairSupported` is false, Pair is disabled and labelled \"Coming soon\".\n- When `available` is false, all modes are off and the server's `unavailableReason` is shown.\n\n**Options panel** (when review is on):\n- **Reviewer vendor** (Pair only): chips for the four vendors with readiness. The executor's own vendor is disabled (\"· executor\"); Gemini and Local are disabled (\"· no CLI\").\n- **Reviewer model:** a select saving `llm.<vendor>.reviewModel`. Its note is \"Resumes the work session on this model\" for Self, or \"Saved as llm.<vendor>.reviewModel\" for Pair.\n- **Fix rounds** (Pair only): a 1 / 2 / 3 segmented control, default 2, with the help text \"How many times the executor may fix must-fix findings before the task fails review.\"\n\n**\"What happens on each task\" strip**, a row of boxes joined by arrows:\n- Pair: executor \"does the task\" → reviewer \"reviews\" → executor \"fixes findings\" → reviewer \"checks the fixes · up to N rounds\".\n- Self: executor \"does the task\" → the same vendor on the reviewer model \"reviews and fixes in the same session\".\n\n**Footnote:** \"Should-fix and lower findings are captured to the PRD instead of blocking the commit. Applies to ndx work and ndx pair-programming; a task's saved run settings can switch review on or off for that task.\"\n\nWhen the reviewer is not ready, show a warning that review would be skipped until it is."
lastModified: "2026-10-10T23:41:00.043Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

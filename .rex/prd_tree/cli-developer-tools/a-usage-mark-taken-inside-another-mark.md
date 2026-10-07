---
id: "18da2319-deb7-42fe-b5da-3dae8347be75"
level: "task"
title: "A usage mark taken inside another mark's window makes both records claim the overlap"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
  - "usage"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Two marks taken in one session, the inner one consumed first, produce records whose token totals sum to the outer window rather than exceeding it (test)."
  - "A single mark with no nesting claims exactly the same tokens it does today (regression test)."
  - "`hench record --help` states how a mark interacts with the session watermark, so the precedence is documented rather than inferred from behaviour."
description: "**Severity:** medium — **Verdict:** should-fix (observed while running /ndx-work, then /ndx-adversarial-review inside it, on branch feat/pr-14-product-views-from-fixtures, 2026-10-06)\n\n**Failure scenario.** In one Claude Code session:\n\n1. `hench usage mark --task=A` at message 77.\n2. Work on A.\n3. `hench usage mark --task=skill:ndx-adversarial-review` at message 155 — the review runs *inside* A's still-open window.\n4. `hench record --task=skill:ndx-adversarial-review` → claims messages 155→202, 10,898,780 tokens.\n5. `hench record --task=A` → claims messages 77→206, 25,341,772 tokens.\n\nStep 5's window contains step 4's entirely, so 10,898,780 tokens are attributed twice — once to task A and once to the review's orphan bucket. `ndx usage` and `get_token_usage` both double-count them. Observed exactly as described; the task record was corrected by hand afterwards (25,341,772 → 14,442,992).\n\n**Cause.** `hench record --help` states the precedence: \"explicit --*-tokens flags, then the mark, then the session watermark, then zeros.\" A mark outranks the watermark, so consuming the inner mark advances the watermark but the outer mark still points at message 77 and wins. The watermark exists to stop exactly this (see the completed siblings 90e6afb9, f1ada08d, f050baf6) but cannot, because the mark takes precedence over it unconditionally.\n\n**Reachability.** A real and recommended path, not synthetic: the `/ndx-work` skill marks at step 8 and records at step 13, and `/ndx-adversarial-review` marks at its step 1 and records at its step 7. Running the review during a work run — which the work skill's own review flow and `ndx work --review` both encourage — produces this every time. The more carefully an operator attributes spend, the more they are over-reported.\n\n**Solution options.**\n\n(a) *Clamp a mark to the watermark (recommended).* When consuming a mark, start from `max(mark.position, watermark)` rather than `mark.position`. Nested windows then partition cleanly: the outer record claims only what was not already claimed by the inner one. Cost: a few lines in the delta computation plus a test with two overlapping marks. Risk: an operator who deliberately re-records an already-claimed window gets zeros — arguably correct, but it changes behaviour for explicit re-records.\n\n(b) *Refuse a second mark while one is open, or warn.* Cheapest to implement and makes the conflict visible at mark time. But it blocks a legitimate workflow — a review genuinely nested inside a task is a reasonable thing to measure — so it trades a silent wrong number for a blocked action.\n\n(c) *Subtract consumed inner marks from the outer window at record time.* Most precise; needs the record to track which marks were consumed inside its own span, which is state the cursor file does not hold today.\n\nRecommend (a): it reuses the watermark that already exists for this purpose and needs no new state."
lastModified: "2026-10-06T21:24:12.239Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

---
id: "169d6398-a8e6-43c3-82f8-4b77eb74774e"
level: "task"
title: "Add the Review tab to the running-task page for runs started with --review"
status: "pending"
priority: "medium"
tags:
  - "live"
  - "web-viewer"
  - "review"
blockedBy:
  - "8050220c-7add-4547-8806-0fc6765acb82"
acceptanceCriteria:
  - "Runs without --review show no Review tab; runs with it show the tab from the start, marked waiting until the review starts."
  - "Findings appear as soon as the review report file is written, with severity, verdict, action and a PRD link for captured ones."
  - "A review that never started or lost its report shows the reason the run recorded, not an empty list."
  - "Finding types are imported through the gateway, not directly from hench (domain-isolation test passes)."
description: "Shown only when the run has the adversarial review pass on (`ndx work --review`). A stage strip above the tabs shows Work → Validate → Review → Commit with the current stage, since the review runs after validation and before the commit so its fixes land in the same commit. While reviewing, the Work tab is marked done and Review running. The Review tab has a Findings / Reviewer log toggle. Findings view: the reviewer's activity from the progress events (started, which model, whether it resumed the work session, scope), then, once `.hench/reviews/<runId>.json` is written, one card per finding with severity (critical, high, medium, low), verdict (must fix, should fix, not worth fixing, out of scope), what the reviewer did (fixed, captured to the PRD with a link to the new item, dropped, failed), the scenario and the location; dropped findings collapsed; then the current step (for example re-running tests after the reviewer's fix). Reviewer log view: the review part of the run log. Side column: counts by outcome, the reviewer model and which setting chose it (`--review-model`, `llm.<vendor>.reviewModel`, `llm.reviewModel` or the vendor default), turns, tokens and cost, and a note that review is a gate (completion is refused if the reviewer cannot start unless `--review-optional`). Finding types come from `packages/hench/src/agent/analysis/adversarial-review.ts` through the web server's hench gateway. The report is written once, when the reviewer finishes; before that the tab shows activity and the log only."
lastModified: "2026-10-01T00:21:22.422Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

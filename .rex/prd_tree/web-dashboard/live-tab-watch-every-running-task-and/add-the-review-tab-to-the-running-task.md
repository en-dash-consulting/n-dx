---
id: "169d6398-a8e6-43c3-82f8-4b77eb74774e"
level: "task"
title: "Add the Review tab to the running-task page for runs started with --review"
status: "in_progress"
priority: "medium"
tags:
  - "live"
  - "web-viewer"
  - "review"
blockedBy:
  - "8050220c-7add-4547-8806-0fc6765acb82"
startedAt: "2026-10-01T05:58:11.556Z"
acceptanceCriteria:
  - "Runs without --review show no Review tab; runs with it show the tab from the start, marked waiting until the review starts."
  - "Findings appear as soon as the review report file is written, with severity, verdict, action and a PRD link for captured ones."
  - "A review that never started or lost its report shows the reason the run recorded, not an empty list."
  - "The web package gains no @n-dx/hench dependency and no new gateway; the report is read from disk and typed locally, and a report with unknown enum values or missing fields still renders (unit test). domain-isolation and architecture-policy tests pass."
description: "Shown only when the run has the adversarial review pass on (`ndx work --review`). A stage strip above the tabs shows Work → Validate → Review → Commit with the current stage, since the review runs after validation and before the commit so its fixes land in the same commit. While reviewing, the Work tab is marked done and Review running. The Review tab has a Findings / Reviewer log toggle. Findings view: the reviewer's activity from the progress events (started, which model, whether it resumed the work session, scope), then, once `.hench/reviews/<runId>.json` is written, one card per finding with severity (critical, high, medium, low), verdict (must fix, should fix, not worth fixing, out of scope), what the reviewer did (fixed, captured to the PRD with a link to the new item, dropped, failed), the scenario and the location; dropped findings collapsed; then the current step (for example re-running tests after the reviewer's fix). Reviewer log view: the review part of the run log. Side column: counts by outcome, the reviewer model and which setting chose it (`--review-model`, `llm.<vendor>.reviewModel`, `llm.reviewModel` or the vendor default), turns, tokens and cost, and a note that review is a gate (completion is refused if the reviewer cannot start unless `--review-optional`). The report is written once, when the reviewer finishes; before that the tab shows activity and the log only.\n\nHow to read the report: the web package does not depend on `@n-dx/hench` and has no hench gateway, and this task must not add either. Read `.hench/reviews/<runId>.json` from disk in the web server (resolving the run's worktree the same way the run detail and log tail routes do) and type it with a minimal local interface, the same pattern as `RunSummary` in `packages/web/src/server/routes-hench.ts`. The field names and value sets to mirror are `ReviewReport` and `ReviewFinding` in `packages/hench/src/agent/analysis/adversarial-review.ts` (finding: `title`, `location`, `severity`, `verdict`, `scenario`, `action`, `itemId`, `note`, `disposition`, `reason`; report: `taskId`, `findings`, `fixesApplied`, `summary`). Treat every field as optional and render an unrecognised severity, verdict or action as its raw text rather than dropping the finding."
lastModified: "2026-10-01T05:58:11.943Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

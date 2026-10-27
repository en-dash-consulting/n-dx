---
id: "3b3e6b76-14ae-4978-a320-5993b7b276b0"
type: "capability"
title: "A review pass that could not run must not report a completed, reviewed task"
slug: "a-review-pass-that-could-not-run-must"
statement: "When the reviewer requested for a hench run cannot run, the run's outcome names the missing review rather than reporting a plain completed, reviewed task."
criteria: [{"id":"c1","text":"If the reviewer for a run started with --review cannot spawn, hench shall not report the run as a plain 'completed' and shall name the missing review in the run's outcome."},{"id":"c2","text":"If the reviewer for a run cannot spawn, hench shall print a prominent warning in the run summary that the review did not run."},{"id":"c3","text":"If the reviewer for a run cannot spawn, hench shall record on the run that it is completed but unreviewed, so the dashboard can show it as 'completed, unreviewed'."},{"id":"c4","text":"When the reviewer for a run ran and found nothing, hench shall report the run's outcome exactly as it would without the missing-review handling."},{"id":"c5","text":"Hench shall keep a review that could not spawn (an infrastructure failure) separate from a review that ran and reported findings in the run's recorded outcome."}]
priority: "high"
---

Found by running the #370 follow-up queue on 2026-09-12. Severity: high — --review is sold as a gate, and a reviewer that never spawns is indistinguishable from a reviewer that found nothing.

FAILURE SCENARIO
Task 9cea889f ran with --review --review-model=claude-fable-5-1 against a Claude Code CLI too old for that model. The reviewer spawn returned 400 and the run record shows review: { failed: 'spawn-failed', detail: 'API Error: 400 ... version 2.1.251 or newer is required' }. The run still reported status completed, committed its work, and printed no warning in the final summary. The operator had asked for an adversarial review on a critical task touching the run lifecycle and got none, with nothing in the completion output saying so.

review.failed is consulted in exactly two places (packages/hench/src/agent/lifecycle/shared.ts): commitReviewRepairsIfNeeded returns early on it, and the uncommitted-work gate excludes repairedFiles from its discount list. Neither affects run status, and nothing surfaces it to the operator.

SOLUTION
Decide and implement a policy for a review pass that could not run, distinguishing it from a review that ran and found nothing:
- At minimum: print a prominent warning in the run summary and record it on the run so the dashboard shows 'completed, unreviewed'.
- Preferred: a spawn-failed review fails the task when --review was explicitly requested (an opt-in gate that silently no-ops is worse than no gate), with a flag such as --review-optional or hench.reviewOptional for operators who want best-effort.
- Distinguish spawn-failed (infrastructure) from a review that ran and reported findings. A model-unavailable 400 is a configuration error the operator can fix and retry; it should not consume the task's retry budget or defer the task.

ACCEPTANCE CRITERIA
- A run whose reviewer cannot spawn does not silently report a plain 'completed'; the outcome names the missing review.
- A run whose reviewer ran and found nothing is unaffected.
- The chosen policy is covered by a unit test that fakes a spawn-failed review.
- Changeset for @n-dx/hench (patch).

Conventions: cross-package imports through packages/hench/src/prd/rex-gateway.ts; no node:child_process in hench; pnpm test from the repo root before declaring done.

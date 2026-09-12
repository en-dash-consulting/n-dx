---
id: "3b3e6b76-14ae-4978-a320-5993b7b276b0"
level: "task"
title: "A review pass that could not run must not report a completed, reviewed task"
status: "completed"
priority: "high"
startedAt: "2026-09-12T09:14:42.830Z"
completedAt: "2026-09-12T09:33:06.829Z"
endedAt: "2026-09-12T09:33:06.829Z"
acceptanceCriteria: []
description: "Found by running the #370 follow-up queue on 2026-09-12. Severity: high — --review is sold as a gate, and a reviewer that never spawns is indistinguishable from a reviewer that found nothing.\n\nFAILURE SCENARIO\nTask 9cea889f ran with --review --review-model=claude-fable-5-1 against a Claude Code CLI too old for that model. The reviewer spawn returned 400 and the run record shows review: { failed: 'spawn-failed', detail: 'API Error: 400 ... version 2.1.251 or newer is required' }. The run still reported status completed, committed its work, and printed no warning in the final summary. The operator had asked for an adversarial review on a critical task touching the run lifecycle and got none, with nothing in the completion output saying so.\n\nreview.failed is consulted in exactly two places (packages/hench/src/agent/lifecycle/shared.ts): commitReviewRepairsIfNeeded returns early on it, and the uncommitted-work gate excludes repairedFiles from its discount list. Neither affects run status, and nothing surfaces it to the operator.\n\nSOLUTION\nDecide and implement a policy for a review pass that could not run, distinguishing it from a review that ran and found nothing:\n- At minimum: print a prominent warning in the run summary and record it on the run so the dashboard shows 'completed, unreviewed'.\n- Preferred: a spawn-failed review fails the task when --review was explicitly requested (an opt-in gate that silently no-ops is worse than no gate), with a flag such as --review-optional or hench.reviewOptional for operators who want best-effort.\n- Distinguish spawn-failed (infrastructure) from a review that ran and reported findings. A model-unavailable 400 is a configuration error the operator can fix and retry; it should not consume the task's retry budget or defer the task.\n\nACCEPTANCE CRITERIA\n- A run whose reviewer cannot spawn does not silently report a plain 'completed'; the outcome names the missing review.\n- A run whose reviewer ran and found nothing is unaffected.\n- The chosen policy is covered by a unit test that fakes a spawn-failed review.\n- Changeset for @n-dx/hench (patch).\n\nConventions: cross-package imports through packages/hench/src/prd/rex-gateway.ts; no node:child_process in hench; pnpm test from the repo root before declaring done."
lastModified: "2026-09-12T09:33:07.134Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

---
"@n-dx/web": patch
"@n-dx/hench": patch
---

The dashboard's Adaptive and Workflow tuners now propose token budgets in the
units the budget is enforced in, and never below the cost a run pays to
arrive.

`routes-adaptive.ts` and `routes-workflow.ts` each carried a self-contained
copy of hench's tuners, with the defect hench's own copy had already fixed:
`totalTokens` was `input + output`, which on a prompt-cached run is roughly a
twelfth of what `checkTokenBudget` enforces; the high-consumption threshold
was a fixed 100,000 in those smaller units; and no proposal was clamped to the
measured arrival cost. Unlike hench's tuners these routes are wired into the
dashboard, so an operator could press Apply on a budget below the context
write every run pays — and every run afterwards would fail before doing any
work.

The counting rule, the arrival-cost floor and the two thresholds now live in
`packages/web/src/server/token-cost.ts`, a deliberate port of hench's module
shared by both routes. Web does not depend on hench and adding a gateway to
reach three pure functions would be an architecture change made in passing, so
the port stays — and `tests/e2e/token-cost-parity.test.js` drives both
implementations over the same fixtures and fails when they disagree. hench's
two threshold constants moved into its own `token-cost.ts` and are exported,
so the parity test compares real values rather than a third copy of the
literals.

Adjustments are also no longer labelled "auto-applied". Nothing in the server
writes the config — the Apply button posts `automatic: false` — but the
notification type was `auto-applied` whenever adaptive mode was enabled, which
is the default, presenting an unapplied number as already in force.

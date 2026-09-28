---
"@n-dx/hench": patch
---

Measure run cost in the adaptive and workflow tuners the same way `checkTokenBudget` does.

Both tuners summed input + output, which on a prompt-cached run is roughly a
tenth of what the budget counts. Fitted against the 600K template budgets, the
adaptive tuner proposed a `tokenBudget` near 112K — below the ~185K a run pays
on arrival for its initial context write — so every later run would have failed
before doing any work.

Counting now goes through one helper (`agent/token-cost.ts`) shared with
`checkTokenBudget`: uncached input + cache writes + output, cache reads
excluded. Neither tuner proposes a budget below the measured arrival cost, and
the workflow tuner's high-consumption threshold is rescaled into the same
units. `ProjectMetrics` and `WorkflowStats` gain an additive
`contextWriteFloor` field.

The rescaled 1.2M high-consumption threshold now applies only when the run set
has a non-zero `contextWriteFloor` (at least one completed run paid a cache
write). A project with no cache writes still gets the original 100K
threshold, so it isn't silenced by a threshold rescaled for a population it
isn't part of.

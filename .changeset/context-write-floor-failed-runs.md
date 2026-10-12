---
"@n-dx/hench": patch
---

`contextWriteFloor` no longer returns 0 for a project whose prompt-cached runs
have all failed, so the tuners' token-budget clamps hold in the situation they
were built for.

The floor counted only runs that both completed and wrote cache. A run set
with no completed run therefore measured 0, however much cache its runs wrote
— and every clamp built on it (`Math.max(proposed, floor)` in `adaptive.ts`
twice and `workflow.ts` once) degenerated to a no-op, on a project that was
already failing every run. It now falls back to the cheapest
`cacheCreationInput` among the cache-writing runs — the cache-write component
rather than the run's total, because a failed run's total also carries whatever
work it managed before failing.

That fallback is an *upper* estimate of arrival cost, not a lower bound:
`cacheCreationInput` sums a run's cache writes over every turn, not the arrival
write alone. So it is applied only where a budget is being raised. The
high-usage cap in `workflow.ts` exists to curb waste, and flooring it with the
fallback would lift it to the cheapest runaway's whole cache-write total — on a
set of 3M-cache failures it proposed 3M instead of the intended reduction. That
cap now clamps only to a floor measured from a run that completed, and
`contextWriteFloorFromCompletedRun` says which kind of floor is in hand.

The workflow tuner's high-usage threshold asked the same function a different
question — "is this project prompt-cached?" — by testing `floor > 0`. Those
are not the same question: whether totals carry cache writes is a property of
how the runs were made, while the floor needs a run that survived. A new
`hasCacheWrites` answers the first from any cache-writing run whatever its
status, and `WorkflowStats` carries it as `promptCached`. An all-failed
prompt-cached set no longer reads as uncached, so its 12x-inflated average is
compared against the 1.2M cached threshold instead of the 100K uncached one
and stops firing a suggestion the rescale exists to silence.

Test hardening from the same review: both threshold tests now pin
`successRate < 0.5` so neither can pass because the suggestion's other half
stopped holding; the adaptive floor test is named for what it guards; and
there is a case at the shipped 600,000 template budget that states which
branch fires rather than looping over a possibly-empty list.

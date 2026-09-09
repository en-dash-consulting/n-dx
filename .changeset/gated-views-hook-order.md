---
"@n-dx/web": patch
---

Call every hook before the enrichment gate in Problems and Suggestions.

Both views return an `EnrichmentGate` early when the analysis has not reached
their threshold, and then called `useMemo` below it. `enrichmentPass` is loaded
data — 0 on the first render, real once the data arrives, and different again
when an analysis finishes with the dashboard open — so the early return is taken
on some renders of the same mounted component and not others, and every hook
below it was conditional. Preact matches hooks by position and, unlike React,
does not warn: the slots simply shift.

Both views now call their hooks first and gate afterwards. `findings` is
memoized on the source array while moving, which also makes the memo that keys
on it work at all — a fresh array each render meant it recomputed every time.

The invariant is pinned structurally, by asserting neither view calls a hook
after its early return. A behavioural test cannot fail on this defect: the
conditional hooks were appended after the stable ones, so nothing is misread
today and the exposure is to the next edit. Transition tests cover the other
half — crossing the threshold in both directions, repeatedly, renders what it
did before.

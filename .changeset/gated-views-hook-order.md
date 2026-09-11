---
"@n-dx/web": patch
---

Call every hook before the enrichment gate in all three gated SourceVision views.

Architecture, Problems and Suggestions each return an `EnrichmentGate` early when
the analysis has not reached their threshold, and then called `useMemo` below it.
`enrichmentPass` is loaded data — 0 on the first render, real once the data
arrives, and different again when an analysis finishes with the dashboard open —
so the early return is taken on some renders of the same mounted component and
not others, and every hook below it was conditional. Preact matches hooks by
position and, unlike React, does not warn: the slots simply shift.

All three now call their hooks first and gate afterwards. In Problems and
Suggestions `findings` is memoized on the source array while moving, which also
makes the memo that keys on it work at all — a fresh array each render meant it
recomputed every time. Architecture needed only the one memo hoisted; nothing
there keys on `findings`, so it stays a plain filter below the gate.

The invariant is pinned structurally, by asserting no view calls a hook after its
early return. A behavioural test cannot fail on this defect: the conditional
hooks were appended after the stable ones, so nothing is misread today and the
exposure is to the next edit. Transition tests cover the other half — crossing
the threshold in both directions, repeatedly, renders what it did before.

The guard's view list is itself checked against the directory, so a view that
renders an `EnrichmentGate` cannot be added without being covered. That gap is
why Architecture was missed the first time: the list was hardcoded to two
entries while the suite claimed to check every gated view.

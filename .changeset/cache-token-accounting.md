---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Count and price cache tokens in every usage rollup.

Run records carry four token fields — input, output, cacheCreationInput,
cacheReadInput — but the rollups summed only the first two, and neither cost
estimator priced the cache at all. On this repo `ndx usage` reported 1,212,931
tokens and $18.00 across 1,024 runs; the same runs actually hold 668,969,084
tokens and cost roughly $237.74. Cache reads alone were 662M of that, 99% of
all tokens and completely invisible.

Cache tokens are billed, not free: a write costs about 1.25x the input rate and
a read about 0.1x. Dropping them did not make the estimate approximate, it made
it wrong by more than an order of magnitude — and it hid the one number the
cost work moves, since batching and warm-parent forking trade fresh input for
cache reads.

`PackageTokenUsage`, `AggregateTokenUsage`, and `TokenEvent` now carry
`cacheCreationTokens` and `cacheReadTokens` through extraction, grouping, and
aggregation. `ModelPricing` gains cache rates and `CostEstimate` reports the
two new cost components. CLI output breaks the four kinds out rather than
collapsing them, since they bill at four different rates — cache segments are
omitted when zero, so a project that never caches keeps the old two-part line.

The dashboard already counted cache tokens but never priced them; its
`estimateCost` now matches. Because the dashboard keeps a second copy of the
aggregation, a new parity test pins the two pricing tables and both cost
formulas to each other so they cannot drift into quoting different dollar
figures for the same runs.

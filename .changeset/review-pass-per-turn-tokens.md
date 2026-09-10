---
"@n-dx/hench": patch
---

Charge the adversarial review pass's per-turn tokens to the run record.

`runAdversarialReviewPass` added the reviewer's aggregate spend to
`run.tokenUsage` but never merged `result.turnTokenUsage` into
`run.turnTokenUsage` — `accumulateResult` is the only path that concats the
per-turn array, and the review pass does not go through it.

The per-turn half is the one that reaches the rollups. Rex's
`extractHenchTokenEvents` builds its usage events from `turnTokenUsage`
whenever that array is non-empty and then advances to the next run; it never
falls back to the aggregate. A run carrying only the executor's turns
therefore reports only the executor's spend, however large `tokenUsage` grew.

Measured on live run 5c1e9bee (executor claude-sonnet-4-6, reviewer
claude-opus-5): `run.tokenUsage.output` was 28,920 while all 20 per-turn
entries were tagged sonnet and summed to 3,154 output. `ndx usage` printed the
aggregate as its headline (29,082) and the per-turn sum as the per-command
line (3,200) in the same report — an 89% under-report — and priced the whole
run at Sonnet rates although roughly 25.8k of the 28.9k output tokens were
billed to opus-5.

The two halves now move together in one place, `chargeReviewToRun`. The
reviewer's turn numbers restart at 1, so they are offset past the executor's
highest turn to keep `turn` monotonic within a run. Entries are tagged with
the review model, with an unresolved model (the local vendor sends no model
flag) normalized from `""` to absent so the `turn.model ?? run.model` fallback
downstream still engages. A reviewer that reports no per-turn data contributes
none rather than one synthetic entry — fabricated per-turn data is
indistinguishable from measured data once written.

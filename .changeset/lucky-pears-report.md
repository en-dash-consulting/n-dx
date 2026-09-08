---
"@n-dx/hench": patch
---

Merge the adversarial review pass's per-turn token usage into the run record.

`runAdversarialReviewPass` added the reviewer's aggregate to `run.tokenUsage`
but never appended `result.turnTokenUsage` to `run.turnTokenUsage`. rex's
`extractHenchTokenEvents` builds usage events from `turnTokenUsage` whenever it
is non-empty and never falls back to the aggregate, so the reviewer's spend was
invisible to `ndx usage`'s per-command line and to the dashboard rollup — and
the whole run was costed at the executor's model.

Measured on a live `--review` run (executor claude-sonnet-4-6, reviewer
claude-opus-5): `run.tokenUsage.output` was 28,920 while all 20 per-turn
entries were tagged claude-sonnet-4-6 and summed to 3,154 — an 89%
under-report in the same `ndx usage` output that printed the aggregate as its
headline.

`mergeReviewTokenUsage` now charges both halves. Reviewer entries are tagged
with the review model so per-model costing prices them correctly, and their
turn numbers continue after the executor's last turn so `hench show` reads as
one sequence.

---
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

Price token usage at each model's own rates instead of Claude Sonnet's.

`estimateCost` took a `ModelPricing` parameter that every caller left at a
single hardcoded Sonnet default (3/15 per MTok, cache write 3.75, cache read
0.30). A project configured for Opus (5/25) therefore had its spend
under-reported by exactly the Sonnet-to-Opus ratio — on this repo's own run
history, $124 quoted against a real $186. The `(based on Sonnet pricing)`
label made that honest rather than silently wrong, but it left the figures
unusable for the before/after comparisons the cost work depends on.

- `@n-dx/llm-client` — `MODEL_COSTS` gains cache-write and cache-read rates,
  so the existing catalog now covers all four billed token kinds for every
  model in `TIER_MODELS` across claude, codex and google. New `model-pricing`
  module exports `resolveModelPricing` (exact id → Claude alias → Codex legacy
  remap → labelled fallback) and `priceTokens`. Two known under-reporting
  caveats are documented on the table: a 1-hour cache write bills at 2x input
  rather than 1.25x, and long-context surcharges apply above 200K input on
  some models. Neither is recoverable from aggregate token counts.
- `@n-dx/rex` — token aggregation carries a per-model split (`byModel`) drawn
  from hench per-turn records, which already recorded vendor and model, so a
  run that switched models mid-flight is priced per segment rather than at its
  run-level model. `estimateCost` prices each bucket at its own rates and
  reports a per-model breakdown; tokens with no recorded model, and any
  remainder between the buckets and the totals, form a separate `unattributed`
  line at the fallback rate. An unrecognised model id degrades to that same
  labelled fallback rather than throwing or pricing at zero. `ndx usage` now
  prints the per-model split in place of the blanket Sonnet caveat, and emits
  it in `--format=json`.
- `@n-dx/web` — the dashboard's duplicate pricing literal is gone; it resolves
  the same fallback rates from the shared table. Its own aggregation does not
  yet carry a per-model split, so dashboard figures still price everything at
  the fallback — tracked separately.

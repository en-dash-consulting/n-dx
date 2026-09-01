---
"@n-dx/llm-client": patch
---

Record that `MODEL_COSTS.outputPerMToken` feeds no computation

`outputPerMToken` is multiplied nowhere in the codebase. Its only references
were shape assertions in the tests — every entry has the field, and the output
rate is `>=` the input rate. The single live cost calculation, `budgetPreflight`,
multiplies `inputPerMToken` only.

The consequence had already bitten once: of the three price corrections in the
preceding `MODEL_COSTS` fix, the two output-side edits (`claude-haiku-4-5`
4.00→5.00 and `claude-opus-4-7` 75.00→25.00) changed no computed value anywhere,
so a change presented as improving cost estimation was half inert.

Resolved as **informational-only** rather than by wiring the output rates into a
calculation. The reason is structural, not lack of appetite: budget preflight
runs *before* generation, so the output token count does not exist at the point
the estimate is made. Pricing the output side needs a caller that knows the
actual output count — post-hoc usage attribution (`ndx usage`, rex's
`get_token_usage` rollup) — which is a feature, not a fix, and was deliberately
not built here. `budgetPreflight` also has no in-repo production caller today, so
adding an estimator beneath it would have recreated the same "looks live, isn't"
problem one layer up.

What changed:

- The `MODEL_COSTS` doc comment now states which field feeds a computation and
  which does not, why preflight is input-only, that correcting an output rate
  changes no computed value (treat it as a data fix, not a behaviour change), and
  where the output side would have to live to become active. It also notes that
  hench's recorded `costUsd` comes from the provider's own reported `cost_usd`,
  not from this table.
- `BudgetPreflightResult.estimatedCostUsd` is documented as an input-only floor,
  not a total — output dominates cost on generation-heavy requests.
- A regression test locks the input-only contract against a model whose input and
  output rates differ, asserting the estimate equals the input-derived figure and
  is *not* the input+output sum. Verified as a real lock by mutation: folding
  output cost into the estimate fails it.
- The `MODEL_COSTS` test block is labelled as shape guards, so passing it is not
  mistaken for coverage of a cost calculation.

No behaviour change, and no price values were edited. The four Claude entries
were checked against current published per-MTok pricing while making the
decision and all match: Opus 5 $5/$25, Sonnet 5 $3/$15, Haiku 4.5 $1/$5,
Fable 5 $10/$50.

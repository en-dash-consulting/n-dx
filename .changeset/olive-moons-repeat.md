---
"@n-dx/rex": patch
---

Leave an analyze run's recorded cost unset when it cannot be known

`priceAnalyzeTokenUsage` ignored `resolveModelPricing(...).known` and priced
every run, so an unpriced model was charged at the fallback rates — which are
`claude-sonnet-5`'s, making the guess indistinguishable from a real sonnet run.
A run whose provider omitted usage priced to exactly `0`. Both reached the
`analyze_token_usage` log as numbers, and `ndx`'s run summary presents whatever
number it finds as actual spend.

It now returns `undefined` unless both the token counts and the model's pricing
are known. `JSON.stringify` drops the key, and `formatCost` renders a missing
cost as "not recorded" — which tells an operator to go and look, where "$0.00"
does not.

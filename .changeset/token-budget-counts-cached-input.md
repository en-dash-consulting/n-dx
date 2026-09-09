---
"@n-dx/hench": patch
---

Count cached input toward `hench.tokenBudget`

`checkTokenBudget` summed `input + output`. Once the API agent loop gained
`cache_control` breakpoints, `input` held only the uncached slice — an 83-turn
run recorded 534 uncached input tokens against 876K cache writes and 34.1M
cache reads — so a configured budget bounded output plus a rounding error and
the run continued to `maxTurns` instead of stopping.

The total is now every token the run processed at face value: uncached input,
cache writes, cache reads, and output, via the existing `normalizeRunTokens`
helper. This restores the pre-caching meaning (tokens processed per run) and
stays vendor-neutral — no price table. The budget-exceeded messages on both
loops report the inclusive total, since both read `budgetCheck.totalUsed`.

Runs with no cache activity are unaffected.

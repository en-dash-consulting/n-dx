---
"@n-dx/hench": patch
---

Count cached input toward `hench.tokenBudget`

`checkTokenBudget` summed `input + output`. Once the API agent loop gained
`cache_control` breakpoints, `input` held only the uncached slice — an 83-turn
run recorded 534 uncached input tokens against 876K cache writes and 34.1M
cache reads — so a configured budget bounded output plus a rounding error and
the run continued to `maxTurns` instead of stopping.

On the API loop the total is now every token the run processed at face value:
uncached input, cache writes, cache reads, and output, via the existing
`normalizeRunTokens` helper. This restores the pre-caching meaning (tokens
processed per run) and stays vendor-neutral — no price table. The
budget-exceeded messages report whatever `budgetCheck.totalUsed` counted.

The CLI provider's post-run check excludes cache reads. That check fires
after the run already finished, so it cannot stop anything — its only effect
is to mark a *successful* run `budget_exceeded` and reset the task before
review and commit. A Claude Code session re-reads its cached prefix every
turn, so cache reads there reach the millions on any non-trivial run; at face
value every configured budget (including the 30K–200K built-in template
budgets) would trip on every run. Uncached input, cache writes and output —
the tokens that would have been `input + output` before caching — still
count on that path.

A budget on the API loop now sees cache traffic it previously ignored, so a
budget tuned to the old accounting may need raising there. Runs with no cache
activity are unaffected on both paths.

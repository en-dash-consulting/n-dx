---
"@n-dx/hench": patch
"@n-dx/web": patch
---

`hench.tokenBudget` counts cache writes and excludes cache reads

`checkTokenBudget` summed `input + output`. With prompt caching, `input` holds
only the uncached slice — an 83-turn API-loop run recorded 534 uncached input
tokens against 876K cache writes and 34.1M cache reads — so a configured budget
bounded output plus a rounding error, and the run continued to `maxTurns`
instead of stopping.

The budget now counts **uncached input + cache writes + output**, on the API
loops and the Claude and Codex CLI paths alike, and excludes cache reads. A
cache read is by construction a re-read of tokens already counted when they
were written, so counting reads would charge the same tokens once per turn:
across the 27 recorded runs in this repository, face value ran a median of
**70x** the counted total. On the Claude CLI path, where the check runs after
the session has finished, that would have marked every non-trivial run
`budget_exceeded` and reset its task before the review and commit steps. The
rule needs no price table and stays vendor-neutral, and runaway loops remain
bounded because cache writes and output both grow with turn count.

A run that writes no cache counts exactly what it did before. A Claude Code
session always writes one, so on the CLI path every run now also counts its
cache writes, and a budget tuned to the old accounting may need raising on
either path.

Also:

- Built-in template budgets re-derived from measured runs. Counted cost is
  affine in turn count — roughly `190,000 + 5,400 x turns`, where the constant
  is the initial context write — so each budget is that fit at the template's
  `maxTurns`, doubled for headroom: quick-iteration 50K -> 600K,
  thorough-execution 200K -> 1.5M, budget-conscious 30K -> 600K,
  api-direct 150K -> 850K. The old values predated prompt caching and sat
  below a single median run. `budget-conscious` is not tightened below
  `quick-iteration` despite its name: measured runs in its turn class
  *completed* at 484K and 489K, so a lower budget would fail finished work —
  it economises through `maxTurns` and its 4096 `maxTokens` cap instead. The
  dashboard's template list carries the same values.
- The budget-exceeded message now names the token classes that counted and how
  many cache-read tokens were excluded, so a genuine overrun can be told apart
  from cache-read inflation.

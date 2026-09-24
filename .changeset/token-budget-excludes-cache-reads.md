---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Stop prompt-cache reads from tripping `hench.tokenBudget`

`checkTokenBudget` now counts **uncached input + cache writes + output** and
excludes cache reads. A cache read is by construction a re-read of tokens
already counted when they were written, so counting reads charged the same
tokens once per turn: across the 27 recorded runs in this repository face
value ran a median of **70x** the counted total.

The practical failure was on the Claude CLI path, where the check runs after
the run. A Claude Code session reading millions of cached tokens exceeded every
built-in template budget, so a run that had finished its work was marked
`budget_exceeded` and its task reset to `pending` before the review and commit
steps. The previous change to this check fixed the API loop — where
`usage.input` holds only the uncached slice — but counted cache reads at face
value, which broke the CLI path. Both loops now apply the same rule, and the
API-loop run that motivated that change is still stopped, by its cache writes.

Runaway loops remain bounded: cache writes and output both grow with turn count.

Also:

- Built-in template budgets re-derived from measured runs (`maxTurns` x ~6K
  counted tokens/turn x 2 headroom), each with its basis in a comment:
  quick-iteration 50K -> 200K, thorough-execution 200K -> 1M,
  budget-conscious 30K -> 150K, api-direct 150K -> 500K. The old values
  predated prompt caching and sat below a single median run.
- The budget-exceeded message now names the token classes that counted and how
  many cache-read tokens were excluded, so a genuine overrun can be told apart
  from cache-read inflation.

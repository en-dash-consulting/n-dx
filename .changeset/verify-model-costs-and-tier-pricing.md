---
"@n-dx/llm-client": patch
---

Correct claude-sonnet-5 pricing and model threshold-tiered rates

`MODEL_COSTS` had never been checked against the vendors' own pricing pages — the
figures came from a task description. Verified all sixteen entries and found one
outright error plus a policy comment that was wrong twice over.

**claude-sonnet-5 was 50% too expensive: 3.00/15.00 → 2.00/10.00.** Its $2/$10
launch rate was introductory through 2026-08-31, and this table had pre-encoded
the scheduled 2026-09-01 increase to $3/$15. Anthropic cancelled that increase
and made $2/$10 the standard price, so the pre-encoded figure became a straight
overestimate on the default Sonnet tier — noticed on the very day it would have
taken effect.

**gemini-2.5-pro was priced at the wrong tier for large prompts.** Google charges
1.25/10.00 at or below 200k tokens and 2.50/15.00 above it, while the model's
context window is 1M — so prompts in the premium band are routine, not exotic,
and every one of them was being priced at half rate. The old comment claimed the
table used "the standard (higher) tier so estimates never under-report", which
was false for exactly this entry.

`MODEL_COSTS` entries now carry an optional `aboveThreshold` tier
(`{thresholdTokens, inputPerMToken, outputPerMToken}`) and `budgetPreflight`
selects the rate from the tier its token estimate falls in. The result gains a
`costTier` field reporting `"base"` or `"aboveThreshold"`, so a caller comparing
the figure against a rate in the table can tell which rate produced it. Claude
4.6+ bills the full 1M window at standard rates, so no Claude entry carries a
tier; gemini-2.5-pro is currently the only one that does.

Verified against the vendor pages on 2026-09-01, now recorded in the new exported
`PRICES_LAST_VERIFIED` constant. A test cannot detect a vendor price change — any
test pinning prices is tautological against the table and passes while the real
rate moves — so what is recorded is *when* an external check last happened.
Treat prices as suspect once it is more than a quarter old.

Per-vendor status, documented on `MODEL_COSTS`:

- **Claude** — all seven verified against Anthropic's pricing page.
- **Gemini** — all four verified. `gemini-3.7-flash` doubles to 1.50/7.50 on
  2027-01-01; `gemini-2.5-flash`'s higher audio-input rate is not modelled.
- **Codex/OpenAI** — sol/terra/luna verified from the GPT-5.6 announcement
  (openai.com rejects automated fetches). Sol's 4.00/20.00 is promotional at
  least through 2026-11-21. `gpt-5.4-mini` and `gpt-5.5` are **unverified** — no
  current published rate was located, and both are now marked as such.
- **Local** — no entries, and none possible: the vendor resolves to `""` and is
  self-hosted, so there is no per-token price.

Also noted, for the reviewer limitation that prompted this task: the `claude-api`
skill is the sanctioned pricing reference but its files live under a
version- and hash-specific Claude Code install path, so a spawned agent scoped to
the repo generally cannot read it. A reviewer that cannot load it should report
pricing as unverified rather than guess.

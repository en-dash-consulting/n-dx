---
"@n-dx/hench": patch
---

Count what context compaction costs, instead of discarding it.

`createContextSummarizer` destructured only `text` from the completion and threw
`tokenUsage` away. Every prune ships up to 20,000 characters of transcript to the
light-tier model and gets a summary back, so on a long run that spend was real
and entirely unrecorded: `hench show`, the run summary, `rex usage`, the
dashboard and `get_token_usage` all under-reported any run that pruned, and with
`llm.vendor=local` the same loaded model did the extra work with no trace at all.

`PruneSummarizer` now returns `{ text, tokenUsage?, model? }`, `PruneOutcome`
carries `summaryUsage` / `summaryModel`, and all three API loops fold it into the
run via `recordPruneUsage`. The turn is attributed to the light-tier model
`context.summarize` resolved to, not the run's primary model, so the per-turn
breakdown prices it at the tier that actually ran. Usage is reported even when
the summary text was unusable and the prune degraded to a plain drop — the
summary was discarded, the tokens were not. A summarizer that reports no usage
leaves the totals, including the cache fields, untouched.

The pruner stays vendor-neutral: it reports what the summary cost and the loop
decides what to do with it.

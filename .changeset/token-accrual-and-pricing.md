---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

Count each assistant message's tokens once, and price a task's runs in the dashboard.

Claude's `--output-format stream-json` emits one `assistant` line per *content block*, not per message, and every line repeats the finished message in full — `usage` included. A turn that writes a sentence and calls three tools arrives as four lines carrying one turn's tokens four times. Claude Code's session transcripts have the same shape. Both of hench's live ingestion paths summed line by line, so every run's totals were multiplied by the turn's average block count: on a measured session, 234 usage-bearing lines carrying 57 distinct messages, a 4.27x over-count that recorded 23.5M cache-read tokens against the 5.5M actually read.

`UsageMessageFilter` in `@n-dx/llm-client` holds the identity rule — the first sighting of a `message.id` counts, later ones do not. It is applied in `cli-loop`'s token extraction (both the event-pipeline and legacy paths) and in the transcript reader behind `hench record`. Repeats are flagged rather than dropped in the transcript, because cursors and marks address positions by the per-line uuid; removing lines would move every boundary and invalidate every cursor file on disk. Usage carrying no message id is still counted — a vendor that stamps none would otherwise lose its tokens entirely.

The dashboard then had a second problem: it led with a single token total that counted cache reads alongside everything else. Cache reads bill at roughly a tenth of the input rate and outnumber the other three classes by an order of magnitude, so the figure read as tens of millions for work that cost a few dollars. The per-task aggregator now keeps the four billed classes apart instead of collapsing them to one number, and prices each run at the model that run recorded — one task's Haiku and Opus runs are no longer billed at a single blended rate. Cost rolls up through the PRD tree alongside tokens, and the tree's usage column leads with it; the token accounting moves to the cell tooltip, which reports newly-processed tokens and cache reads separately so the price and the token count can be reconciled.

Two errors in the price table itself turned up on the way. `claude-sonnet-5` was priced at $3/$15 — the rates of the Sonnet 4.6 it replaced — overstating every Sonnet 5 figure by 50%; it is the toolkit's standard tier *and* the fallback every unrecognised model is priced at, so the error reached far more surfaces than the runs that named it. And `claude-fable-5-1` was absent, so a Fable 5.1 run silently priced at the Sonnet fallback; its cache-read rate is $0.25/MTok rather than the 0.1x the other Claude rows follow.

Runs already recorded keep the totals they were written with — the run files do not retain message ids, so the over-count cannot be undone after the fact. Runs recorded from here on are correct.

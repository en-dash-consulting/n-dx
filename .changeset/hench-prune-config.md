---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Make the context prune's retention and transcript limits configurable

The summarizing prune in the API loops keeps the most recent turn-pairs
verbatim and shows its summarizer a capped excerpt of each dropped message.
Together those bound how much of a run the agent can still read and how much of
it can reach the summary, so both are tunable rather than hard-coded.

`ConversationPruner` takes the limits as constructor options, and all three API
loops resolve them from the new `hench.prune` config group:
`prune.triggerPairs` (default 20), `prune.retainPairs` (default 10) and
`prune.transcriptMessageChars` (default 2,000). At the pair defaults a prune
fires roughly once every ten turns, which keeps the cached prefix stable between
prunes. Validation refuses a retention at or above the trigger, and either below
2, naming both keys.

The 2,000-character per-message excerpt matches the size at which hench
truncates a tool result for the run record, so a result the run recorded in
full reaches the summarizer in full. The overall transcript is capped at 40,000
characters; since roughly half of a dropped span's messages are tool results at
the cap, a typical span lands well under it and is not cut from the end.

The pruner also clamps its own limits rather than trusting the schema, because
`loadConfig` merges `.n-dx.json`'s `hench` section after validation — so a
`hench.prune` override in that file reaches the agent loop unchecked. An
out-of-range value falls back to the default, and a retention at or above the
trigger falls back to one pair below it and says so in the run log, instead of
ending the run.

The group is CLI- and file-only for now (`ndx config hench.prune.retainPairs
15`). Exposing it in the dashboard first needs a config-aware write gate:
`retainPairs` is only valid relative to `triggerPairs`, and the dashboard's
gate validates one field at a time.

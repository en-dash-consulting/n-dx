---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Make the context prune's retention and transcript limits configurable

The summarizing prune in the API loops kept the most recent 10 turn-pairs
verbatim and showed its summarizer only the first 800 characters of each
dropped message — both hard-coded. Neither was a defect, but together they
bounded how much of a run the agent could still read and how much of it
could reach the summary, with no way to tune either and no visibility into
the trade.

`ConversationPruner` now takes the limits as constructor options, and all
three API loops resolve them from the new `hench.prune` config group:
`prune.triggerPairs` (default 20), `prune.retainPairs` (default 10) and
`prune.transcriptMessageChars`. The pair defaults are unchanged, so peak
context and the one-prune-per-ten-turns cache cadence stay where they were.
Validation refuses a retention at or above the trigger, and either below 2,
naming both keys.

The per-message transcript cap moves from 800 to 2,000 characters, matching
the size at which hench truncates a tool result for the run record — a
2,000-character result previously lost 60% of itself before the summarizer
saw it. The overall cap moves from 20,000 to 40,000 so a full 22-message
span at the new per-message cap is not then cut from the end.

The group is CLI- and file-only for now (`ndx config hench.prune.retainPairs
15`). Exposing it in the dashboard first needs a config-aware write gate:
`retainPairs` is only valid relative to `triggerPairs`, and the dashboard's
gate validates one field at a time.

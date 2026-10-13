---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

`hench show <run> --repoint` now resolves a commit whose object is gone, and
`get_token_usage` reports what a task actually cost.

**Re-pointing from recorded facts.** A run record stores each commit's subject
and author date so a rewritten SHA can be matched to its twin. Those facts were
never read: rex answers "not in this repository" before any twin rule runs, and
its twin key is author *email* + author date + subject, which the record did
not carry. So the feature failed in precisely the case it was built for — a
pruned branch, a fresh clone, `git gc` after a squash merge. Run records now
carry `authorEmail`, and `repointCommits` takes an optional per-SHA `facts` map
it falls back on when git cannot resolve the SHA. The author-date-subject and
trailer-subject rules run from those facts; patch-id cannot, because it needs
the object itself. An unmatched SHA is still reported, never dropped.

**Cost in the rollup.** `costUsd` was `0` on every tuple and nothing ever set
it, so `get_token_usage` reported zero cost for every PRD item. Each run is now
priced at the model it recorded, before the rollup sums — a task's Haiku and
Opus runs bill an order of magnitude apart, so one blended rate over the total
would be wrong for every item that mixed them. A run with no model, or one the
pricing table does not know, prices at the fallback rate, the same rate
`rex usage` quotes for it.

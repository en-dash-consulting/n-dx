---
"@n-dx/rex": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

The v2 migration plan can have Jev review it. Review runs when `rex.placement.models` is `jev` or `both`, or the `jevReview` option is set, and needs a TypeSafe key. Without a key the pass is skipped with one warning. Each item gets one Jev request (task class `prd.migrate.judge`) that batches its questions: a held item's kind and placement, whether an area's title names a job a user does, whether each criterion states product behaviour, and whether each linked test exercises its criterion. Each judged entry records its lowest confidence. The plan summary gains a review queue (held items first, then entries by ascending confidence) and counts of what Jev flagged and dropped. A test link Jev judges irrelevant is dropped only under `autoAccept: confident`. Otherwise it is flagged. A different kind or a process criterion is flagged, never applied. After Jev drops a link, review is re-checked against the approved spec hash, as after any redraft. Migrations may define `summarize`, which rebuilds the summary after every pass.

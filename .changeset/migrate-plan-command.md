---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate --plan` writes the v1 → v2 migration plan out for review.

The classification, data and model passes already existed and were wired to
nothing. `rex migrate-plan` (which `ndx migrate --plan` spawns) now reads the
PRD under the store lock, runs the pipeline over it, and writes two files to an
operator-chosen path: the JSON plan keyed by v1 item id, which the apply step
will read, and a Markdown summary listing every v1 item with its target, the
proposed areas with their notes, the proposed constraints, the dissolved
release epics and the review queue.

Nothing is written to the PRD — planning is a pure read. Both output paths are
refused anywhere inside the rex directory, under the same rule `rex export`
applies: a JSON document at `.rex/prd.json` would be read *as* the PRD on a
checkout without the tree.

Re-planning reads the plan already at `--out` and reuses every model answer
whose item, question and model still match, and reuses its cut time unless
`--cut-at` overrides it — so an unchanged tree re-plans into a byte-identical
file without asking anything. That is also the retry path after a seam error:
the pass is recorded incomplete, the answers already paid for are kept, and the
next run continues from them.

`--rules-only` runs the rules alone, free and fully deterministic. Otherwise
`rex.placement.models` chooses the placement tiers (text by default) and Jev
reviews the plan unless `--no-jev-review`. A text-only placement suggests
rather than places: under `autoAccept: agree` a held change stays held with the
suggestion recorded for a reviewer.

---
"@n-dx/rex": patch
---

`rex recommend` and `rex analyze` tag the changes they create from a sourcevision finding with `code-health`. Placement stopped reading `source: "sourcevision"` and now recognises a finding-derived change by that tag alone, so without this the changes both commands produce lost their architecture-constraint routing and their forced `touches` relation.

Everything `recommend` emits — the run's epic, its zone+category features and their tasks — exists because the analysis reported a finding, so the whole hierarchy carries the tag. In `analyze` only the repairs do: actionable zone findings, circular-dependency tasks and legacy inline zone findings. The zone features and inventory-category epics it proposes as new work stay untagged, because they describe what the codebase has rather than what is wrong with it.

The marker joins `finding:<hash>` and `finding-category:<category>` as a tag that never names a proposal's epic, so grouping and epic titles are unchanged.

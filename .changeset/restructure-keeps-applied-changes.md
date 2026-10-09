---
"@n-dx/rex": patch
---

`rex reshape`, `rex reorganize` and `rex prune` (consolidation and `--smart`) skip, with the reason, a merge that would fold away an applied change and a split, delete or collapse that would remove a change prune keeps; the rest of the batch still applies. The change-layer store refuses any write that removes a change prune keeps, so a retired product node keeps its status row.

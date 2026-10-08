---
"@n-dx/rex": patch
"@n-dx/core": patch
---

New `rex merge-state` git merge driver for the v2 trees' per-folder `state.yaml`: rows merge by item id, so children added or completed on parallel branches merge cleanly. A `metAt` both sides changed is recomputed from the node's spec hash, and a `status` both sides changed reads `completed` when the merged row records a completion; anything else that cannot be decided leaves conflict markers on that field. `ndx init` pins `<rex>/product/**/state.yaml` and `<rex>/changes/**/state.yaml` to `merge=rex-state` and registers the driver beside `rex-prd`.

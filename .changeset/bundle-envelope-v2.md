---
"@n-dx/rex": patch
---

`rex export` (`ndx prd export`) on a v2 tree writes bundle envelope v2, carrying the root header and both the product and change layers, each node's `state.yaml` row apart under `state` so a state key this rex does not declare still imports into `state.yaml`; a v1 tree still writes envelope v1. `rex import-bundle` (`ndx prd import`) accepts both: into a v2 tree a v2 bundle imports whole and a v1 bundle lands in the change layer (its `--replace` replaces that layer only); a v1 tree takes v1 bundles and refuses a v2 one before writing. `--replace` on a v2 tree needs `--no-snapshot`, since `rex restore` covers the v1 tree only. Export still refuses any output path inside the rex directory.

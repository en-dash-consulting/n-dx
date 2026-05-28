---
"sourcevision": patch
---

Zone clustering now uses an explicit edge-weight model. `ImportEdge` gained an
optional `weight` field; Louvain prefers it when set (falling back to
`symbols.length` for any resolver that hasn't opted in). The Swift resolver
now reports raw reference counts (a file that references `AppEnvironment` 20
times is structurally more coupled than one that mentions it once), with each
edge capped at weight 10 so a single hot edge can't dominate zone assignment.
Net effect on Swift codebases: composition-root files cluster with the layer
that uses them heavily, not with the layer whose types they happen to
import.

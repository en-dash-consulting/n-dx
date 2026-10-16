---
"@n-dx/rex": patch
---

The v2 writer keeps a moved folder node's extra top-level `state.yaml` keys (keys a newer rex wrote) in its new folder. A node that moves and loses its last child in the same write is refused, naming its old folder and the keys, instead of dropping them.

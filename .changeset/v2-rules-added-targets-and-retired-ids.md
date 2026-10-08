---
"@n-dx/rex": patch
---

Three more v2 rule errors before the freeze. `ref-resolves` rejects an unapplied change that adds a target some node already claims by id, display id or alias, live or retired, since apply would create a second node under that ref. `ref-unique` rejects a live node whose id a tombstone holds (display ids may be renumbered and a folded id kept as an alias stays allowed). `change-placed-at-close` also fires on an applied change that still carries `needsPlacement`.

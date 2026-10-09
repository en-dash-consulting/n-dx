---
"@n-dx/rex": patch
---

The v2 migration plan now holds every cancelled or deleted item as an unapplied change that needs placement, unless its v1 parent already names its capability or constraint: fix- or work-shaped features, tasks under an area, PR-named epics and root-level items. Before, rules could place them on a capability.

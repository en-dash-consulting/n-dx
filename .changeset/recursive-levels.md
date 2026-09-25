---
"@n-dx/sourcevision": patch
---

Zones get sub-zones again, and the map opens them at any depth. A zone of 30+ files is split whenever the split is balanced (previously it had to be 15% of the whole project). Slivers are folded into their siblings, and sub-zones are named the same way zones are, with numbered sub-zone ids following their chosen names. On the architecture map, any block with tiles on top expands in place: areas into zones, zones into sub-zones, and so on. Connectors are drawn from the deepest visible block at each end.

---
"@n-dx/sourcevision": patch
---

Zones get sub-zones again, and the map opens them at any depth. A zone is split whenever the split is balanced once it reaches 15% of the project's files, capped at 30 files (and never below 12) — previously the 15% trigger was uncapped, so large projects never split their zones. Slivers are folded into their siblings, and sub-zones are named the same way zones are, with numbered sub-zone ids following their chosen names. On the architecture map, any block with tiles on top expands in place: areas into zones, zones into sub-zones, and so on. Connectors are drawn from the deepest visible block at each end.

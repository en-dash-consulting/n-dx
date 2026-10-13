---
"@n-dx/sourcevision": patch
"@n-dx/graview": patch
"@n-dx/graview-face": patch
---

The Graview face shows sourcevision's isometric code map. `ndx graview emit` writes the map in embed mode beside the snapshot when the project is analyzed; the face gets a Code map page under Code, and each zone page shows the map with that zone selected. The map's embed contract gains a `focus` message (`{ type: "ndx-iso", focus: "<zone id>" }`) that opens the area scene holding a zone and selects it, expanding its parent when the zone is drawn as a tile.

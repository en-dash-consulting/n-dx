---
"@n-dx/sourcevision": patch
"@n-dx/graview": patch
"@n-dx/graview-face": patch
---

The Graview face shows sourcevision's isometric code map. `ndx graview emit` writes the map in embed mode beside the snapshot when the project is analyzed; the face gets a Code map page under Code, and each zone page shows the map with that zone selected. The map's embed contract gains a `focus` message (`{ type: "ndx-iso", focus: "<zone id>" }`) that opens the area scene holding a zone and selects it, expanding each ancestor in place for a sub-zone at any depth; an id the map does not draw leaves the view where it is. A project with no map shows "No code map yet": the face's door answers 404 for it rather than letting Vite serve the face's own page, and `pnpm sync` removes a map left from an earlier sync.

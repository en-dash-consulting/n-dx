---
"@n-dx/web": patch
---

Three Graph-view polish moves:

- File Street View hover spotlight. Hovering an edge highlights it and its
  two endpoints; hovering a node highlights every edge touching it and the
  connected nodes; everything else mutes. Cross-zone edge labels show on
  hover even for non-representative edges. A wide invisible hit area on
  each edge makes thin lines forgiving to point at.
- Remove the redundant per-zone "Map of Zone" header (kicker + zone name +
  zone-only stats) from the in-panel Zone Map. Those stats now live in the
  scope-card up in the codebase-map section as "Zone Name · X/Y files · N
  internal · K in / M out", so they're visible without occupying header
  real estate twice.
- Wide-screen layout now applies to any `.ig-graph-shell` (not just the
  zone-active variant) so the Current Selection panel docks to the right at
  ≥ 1280px regardless of which view you're in.

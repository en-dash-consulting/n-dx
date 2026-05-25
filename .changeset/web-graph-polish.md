---
"@n-dx/web": patch
---

Three Graph-view polish fixes:

- Zone map sizing: the per-zone "Zone Map" SVG was rendering at the full
  container width × (640/980) ratio, which on a wide screen exploded to
  >1100px tall and ate the whole viewport. Now pinned to its viewBox aspect
  ratio with a `max-height: min(60vh, 680px)` cap so the map stays the focus,
  not the page.
- Outside-click closes File Street View. Previously only Escape or the Close
  button worked; clicking outside the dialog shell now closes it too,
  mirroring conventional modal behavior.
- Cross-zone edge labels in File Street View are deduplicated. Multiple
  edges between the same source→target zone pair used to stack identical
  "UI Overlays → App-Core Bridge" labels. Now one label per pair, with a
  `×N` count when bundled, positioned at the centroid of the edge bundle.

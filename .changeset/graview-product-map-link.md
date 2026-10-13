---
"@n-dx/web": patch
"@n-dx/graview": patch
"@n-dx/graview-face": patch
"@n-dx/core": patch
---

The dashboard links to the product map. A running Graview face records its URL in `face.json` beside the projection; the dashboard's top bar shows **Product map** while one runs, and `ndx graview info` prints it. With `features.graview.productFace` on (experimental, off by default), the dashboard starts `ndx graview serve` at startup, offers to start one when none is running, and stops it at shutdown. Without `--port` the face now takes 5188 or the next free port, so several checkouts can each serve one. New `/ndx-graview` skill: check, serve and walk the map, and report what is wrong.

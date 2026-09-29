---
"@n-dx/core": patch
"@n-dx/web": patch
---

Add `ndx start --preview`: serves a hand-editable UI layout document (`packages/web/src/preview/index.html`) on port 3118 with live reload, for reshuffling dashboard sections before touching components. It runs no analysis, exposes no MCP endpoints and writes nothing under `.rex/` or `.sourcevision/`, keeps its own `.n-dx-preview.pid`/`.port` files, and relocates rather than killing a port occupant — so it is safe to run alongside a real `ndx start`. `--file=<path.html>` serves a different document.

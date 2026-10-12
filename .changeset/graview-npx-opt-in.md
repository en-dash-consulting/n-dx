---
"@n-dx/graview": patch
"@n-dx/core": patch
---

`ndx graview` no longer downloads graview unasked. When no binary is found through `graview.bin`, `NDX_GRAVIEW_BIN`, PATH or the installed face, every command but `emit` stops and says how to install it, instead of running `npx -y graview@<pinned>`, which fetched a package at command time and hung offline. `graview.allowNpx: true` or `NDX_GRAVIEW_NPX=1` turns the npx fallback back on, and `ndx graview info` names the source as `none` when nothing would run.

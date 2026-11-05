---
"@n-dx/graview": patch
"@n-dx/core": patch
---

`ndx graview` no longer downloads graview unasked. When no binary is found through `graview.bin`, `NDX_GRAVIEW_BIN`, PATH or a face checkout, `check`, `describe`, `mcp` and `serve` with no face to run stop and say how to install it, instead of running `npx -y graview@<pinned>`, which fetched a package at command time and hung offline. `graview.allowNpx: true` in your own, untracked local config or `NDX_GRAVIEW_NPX=1` (`true`, `yes`, `on`) turns the npx fallback back on; a committed config cannot opt every clone in, and `NDX_GRAVIEW_NPX=0` (`false`, `no`, `off`) refuses it, and `ndx graview info` names the source as `none` when nothing would run. `ndx config graview.<key>` now works: `graview.bin` and `graview.allowNpx` go to the machine-local config, which is what the install hint tells you to run.

---
"@n-dx/graview": patch
"@n-dx/core": patch
"@n-dx/llm-client": patch
---

New package `@n-dx/graview`: a read-only projection of an n-dx project into [Graview](https://graview.dev). `ndx graview emit .` writes a `graview-document` declaration (the kinds area, capability, constraint, change, task, release, zone, component, run and commit, with every stored and derived rex relation as a typed edge, five titled lenses and two rules) and a `{nodes, edges}` seed snapshot built from the rex PRD model, sourcevision's zones and components, and hench's run records. `ndx graview check|describe|serve|mcp .` re-emit and spawn the `graview` CLI on the files, so the graph is never older than the tree on disk; `serve` is the store's HTTP and live WebSocket wire that a Graview face connects to, and `mcp` is read-only.

No n-dx package depends on `@graview/*`: the binary is a peer tool resolved from `graview.bin` in the project config, `NDX_GRAVIEW_BIN`, PATH, the installed product face's own `graview`, then `npx -y graview@0.1.20`. Output lands under the layout's new `graviewDir` (`.ndx/graview` or `.graview`), which `ndx init` now gitignores; nothing is written under the rex, sourcevision or hench directories, and the N-DX-Item trailer cache `computeRealizedBy` keeps goes under the graview dir too. File nodes are opt-in (`--files`).

Commits and releases come from git for every tree, v1 included: each commit on main whose `N-DX-Item` trailer names a change or task is a `commit` node (subject, author, date) that `landedFor` it, and a finished change with no stamped `shippedIn` ships with the first release tag containing its landing, so each `release` is dated by its tag and counts what it shipped. The caches go under the graview dir.

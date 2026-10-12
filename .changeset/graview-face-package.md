---
"@n-dx/graview-face": patch
"@n-dx/graview": patch
---

New package `@n-dx/graview-face`: n-dx's face on Graview, a Vite + React product that compiles the document `ndx graview emit` writes, seeds a store from the snapshot, and lays a shell, home and record pages in n-dx's own words over the derived pages, with two-way sync to rex through a dev-server door. It is published on its own and no other `@n-dx/*` package depends on it, so installing n-dx never pulls Graview or React. `ndx graview serve .` finds it beside `@n-dx/graview` in the monorepo or in `node_modules` (or through `graview.app`) and runs its `bin/serve.js` on the fresh projection.

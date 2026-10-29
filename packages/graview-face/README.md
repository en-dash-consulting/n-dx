# @n-dx/graview-face

A product on [Graview](https://graview.dev) for an [n-dx](https://github.com/en-dash-consulting/n-dx)
project: the product layer (areas, capabilities, constraints), the changes and
tasks, the releases, the code (zones, components) and the work (agent runs,
commits) as one typed graph, with a face in n-dx's own words.

The declaration is not here. `ndx graview emit .` in the n-dx project writes
`document.json` (the kinds, relations, lenses, rules, brand, home and record
pages, as data) and `snapshot.json` (the graph, in Graview's line format: a
header saying when it was made and what it holds, then a record a line) under
its graview dir; this repository compiles the document in the page with
`appFromOrCompile`, seeds a store with the snapshot, and lays its own pages
over the derived ones. One source of truth, in the tool that owns the data,
and the types this face reads with are written from it (`pnpm types`).

```sh
pnpm install
pnpm dev            # http://localhost:5188 — the pages; /scene is the map (after `pnpm sync`, or under `ndx graview serve .`)
pnpm verify         # graview doctor, typecheck, headless tests, build, graview check on the declaration
pnpm a11y           # axe-core over the home, a capability, a change and the changes board, both schemes, phone and desktop
pnpm shots          # graview shots: a PNG of every place, from the emitted files
pnpm look           # graview preview: the default faces over the emitted files, no product
```

`NDX_GRAVIEW_DIR` points `pnpm sync` at a project's graview dir (default: this
monorepo's `.graview`). This package is an n-dx extension: its `package.json`
declares an `ndx.extension` block named `graview-face` whose sidecar is
`bin/serve.js`. Once n-dx finds it (installed, or this checkout listed under
`extensions.paths` in `<ndx home>/config.json`) and `ndx extensions enable
graview-face` approves it, `ndx graview serve .` runs it on a fresh projection
with the rex endpoint in the environment. Published on its own:
`npm i -g @n-dx/graview-face`.

## Where things are

```
src/app.ts          compile the document, pair it with the snapshot
src/main.tsx        the scheme, the store (a memory adapter seeded from the snapshot), the two faces
src/faces/          pages (the front door, /pages) and scene (/scene, Graview's own shell)
src/ui/pages.tsx    the page registry: our shell, home, record and list pages over the derived ones
src/ui/shell.tsx    the rail in n-dx's words: Product, Work, Code, Runs, Needs attention, Pictures
src/ui/screens/     home, capability, change, changes, zone, run, attention, spend, generic
src/ui/declared.tsx the declared home and record blocks, worked out by Graview and drawn in our hand
src/ui/kit.tsx      Page, Hero, Stat, Card, Badge, Meter, Section, RecordRow
src/ui/css.ts       the design system, on Graview's theme tokens
src/model/          read models: standing, attention, spend, coverage, fragile zones; types.ts written by graview types
tests/              the declaration compiled from ../graview by path; describePlace over tests/fixtures/snapshot.json (pnpm fixture refreshes it)
scripts/            sync-data, make-fixture, a11y, graview link|npm
UPSTREAM.md         framework workarounds, each with its item in graview's PRD
```

The framework comes from npm, pinned. `pnpm graview:link` consumes a framework
checkout beside the monorepo (`../../../graview` from here, or `GRAVIEW_CHECKOUT`)
by path instead; `pnpm graview:npm` restores the pin.

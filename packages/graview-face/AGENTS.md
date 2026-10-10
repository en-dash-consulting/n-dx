## @n-dx/graview-face: the product face, in the monorepo but outside the tiers

This package is a Graview product: a Vite + React app that compiles the
document `@n-dx/graview` emits (`appFromOrCompile`), seeds a store from the
snapshot, and lays a shell, home and record pages in n-dx's words over the
derived ones. It is published on its own and **no other `@n-dx/*` package
depends on it**: `@n-dx/core` never lists it, so installing n-dx never pulls
`@graview/*` or React. `ndx graview serve .` finds it beside `@n-dx/graview`
in the monorepo, or in `node_modules` when installed, or through
`graview.app` in the project config, and runs `bin/serve.js`.

Rules that keep that honest:

- **It imports no `@n-dx/*` package.** Everything it knows about the graph
  arrives as data in `/data/document.json` and `/data/snapshot.json`
  (`scripts/sync-data.mjs` copies them from the project's graview dir;
  `dev/ndx-door.ts` serves them live). That is why there are no gateways
  here and the domain-isolation tests have nothing to check.
- **The declaration stays in `@n-dx/graview`.** Glance, page groups,
  computed fields, brand, the home and per-kind blocks are data in
  `n-dx.graview.json`; this package adds React and read models
  (`src/model/`) only. A sentence that could be a block belongs there.
- **Rex is the system of record.** `src/sync/` pushes through rex's MCP
  tools behind the dev door (`dev/ndx-door.ts` holds the token and the
  session; the browser never sees either), pre-empts every both-sides edit
  to rex's value, and refuses code-side kinds naming their owner. A static
  build has no door and is read-only by construction.
- **Framework workarounds go in `UPSTREAM.md`** with the graview PRD item
  each was captured as, and come out when the item closes.

Tests are headless (`tests/`): the declaration compiles, every titled place
draws with `describePlace` over `tests/fixtures`, and the sync loop runs
against a fake door. `pnpm a11y` runs axe-core over the built site in both
schemes at phone and desktop width; `node scripts/shots.mjs` writes
screenshots to look at. Both need Playwright's Chromium.

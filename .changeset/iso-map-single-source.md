---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Iso map: one implementation, several gaps closed.

The standalone skill script is now generated from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs` rather than hand-maintained, so the map has a single source of truth; `tests/e2e/iso-skill-drift.test.js` fails if the committed bundle goes stale, and also executes it. This removed a real divergence where the two copies disagreed on zone colours because one counted archetypes before mapping them to kinds and the other after — kinds are now resolved per file and counted once, which answers "what does this zone do" rather than "what is its most common file type".

Also: the project scanner moved into the package (`iso-scan.ts`) and gained tsconfig `paths`, workspace-package and Go `go.mod` resolution, so a monorepo's own packages stop looking third-party; call-graph data, when present, adds per-edge runtime call counts with a Weight: imports/calls toggle and surfaces call-only edges as injected seams; output is reproducible (timestamps default to the HEAD commit time); key files link to source via the git remote; multi-layer edges route through corridors between rows instead of cutting through blocks; and the page gained a light theme, reduced-motion support, kind glyphs alongside colour, a skip link, and a tab order of one stop per zone instead of one per connector.

New: `ndx iso`, `sourcevision iso --source=scan`, and `GET /api/iso-map` in the web dashboard.

---
"@n-dx/sourcevision": patch
---

Read the project config through the layout resolver, not a `.n-dx.json` literal

On a project with `.ndx/` the config lives at `.ndx/config.json`, but every
sourcevision reader still named the legacy path — `analyze`'s risk-justification
and zone-type loaders by deriving it as `resolve(svDir, "..")` plus
`.n-dx.json`, which on the new layout resolves to `.ndx/.n-dx.json`, a file
nothing ever writes. A missing config is a legitimate state, so each reader fell
back to its default without an error: `sourcevision.riskJustifications`,
`sourcevision.zones.types`, the `language` and inventory overrides, archetype
overrides, workspace members and the declared seams and infrastructure on the
iso map were all silently ignored, and the analysis still succeeded with
different results.

The standalone iso bundle cannot reach the resolver, so it gains a hand-written
`projectConfigFor` twin alongside `analysisDirFor`, pinned to the canonical
implementation by `tests/integration/layout-resolver-contract.test.js`.

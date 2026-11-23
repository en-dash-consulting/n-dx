---
id: "b629ca55-3920-442f-8608-642c0a3e4d7a"
type: "change"
title: "docs/packages/sourcevision.md says the PHP pack resolves no imports into edges"
slug: "docs-packages-sourcevision-md-says-the"
summary: "The SourceVision docs page says the PHP pack only reports imports and resolves none, while it actually turns them into dependency links. Readers trust the wrong statement."
intent: "Pre-existing; surfaced by the adversarial review of task ffd82261 (AGENTS.md budget trim), not introduced by it.\n\nScenario: a reader of docs/packages/sourcevision.md \"Pack installation internals\" (about line 94) reads \"php reports its imports as written but resolves none into edges yet\" and concludes PHP files never join imports.json or zones. In fact `use` imports, class references and computable includes reach imports.json as edges through buildPackImportGraph (packages/sourcevision/AGENTS.md \"PHP\" section; packages/sourcevision/tests/integration/php-pack-imports.test.ts), and the same page's \"PHP pack rules\" section documents that resolution.\n\nReachable: user-facing docs page, published on the docs site.\nFix: replace the parenthetical with a statement matching current behaviour (PHP imports resolve into edges and php:<namespace> externals). Cost: one sentence; risk: none. Recommended.\n\nVerdict: out-of-scope (pre-existing), severity low."
acceptanceCriteria:
  - "docs/packages/sourcevision.md no longer says the PHP pack resolves no imports into edges"
  - "The Pack installation internals section's description of php agrees with the PHP section of packages/sourcevision/AGENTS.md"
  - "tests/e2e/docs-command-refs.test.js still passes"
touches:
  - "532cf1ec-2850-4771-9a9e-446e5a36234c"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "documentation"
source: "ndx-adversarial-review"
---

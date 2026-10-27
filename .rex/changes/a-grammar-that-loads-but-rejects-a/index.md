---
id: "302b3909-f481-4577-a120-db5c3726b9d4"
type: "change"
title: "A grammar that loads but rejects a pack query fails the whole imports phase"
slug: "a-grammar-that-loads-but-rejects-a"
intent: "Verdict: should-fix (medium). Found while reviewing the fix for task 7fc53a4a (unloadable grammar), which pre-loads the grammar in buildPackImportGraph but stops there.\n\nScenario: build/grammars/tree-sitter-java.wasm is a valid WASM from an older grammar release (the pin moved, or the queries were edited to use a node type or field the stale grammar lacks), and build-grammars.mjs was not re-run. loadGrammar succeeds, so the new guard passes. runner.parseSource → compile (src/language/runner.ts ~line 114) runs `new Query(language, …)`, which throws a QueryError. The rejection leaves buildPackImportGraph (src/analyzers/pack-imports.ts) and analyzeImports, so imports.json is not written and JS/TS/Go edges are lost too. That is the same blast radius as 7fc53a4a.\n\nReachable: `sv analyze` / `ndx analyze` on a Java project in a checkout whose grammar build predates a query change.\n\nOptions:\n1. (Recommended) Extend the up-front guard in buildPackImportGraph so it covers query compilation as well as the grammar load. For example, the runner could expose `prepare(target)` (compile without parsing), and the guard would call that instead of loadGrammar. Then the same single notice handles both failures. Small cost.\n2. Catch the first parseSource rejection per pack and degrade. Cheaper, but it mixes per-file failures with per-pack ones.\nRelated: the a1e02321 item (grammar version not tied to the build pin) would make this mismatch rarer, but would not stop a stale local build.\n\nConstraints from the language hub (2026-10-08): packages/sourcevision/src/analyzers/pack-imports.ts is also edited on the Go branch (PR 6 changes packsFor() and the `present` filter to require pack.resolver !== undefined). Keep this fix inside the per-pack loop, where the grammar and queries are loaded (next to PR 4's loadGrammar try/catch); for example, wrap query compilation and parsing for that pack and degrade it to inventory-only with one notice. Do not reformat, move or edit the packsFor / present lines, so merging PR 5 into PR 6 stays clean. This fix is on the critical path: PR 5 is merged into the Go stack before the Go resolver (PR 7) sends Go queries through the imports phase."
acceptanceCriteria:
  - "With a grammarDir whose tree-sitter-java.wasm loads but whose pack has a query naming an unknown node type, buildPackImportGraph resolves without throwing and returns no Java edges"
  - "That run emits exactly one notice naming the pack and the query compile error"
  - "A unit test in tests/unit/analyzers/pack-imports.test.ts covers the case (for example, a pack with a bad query file over the built Java grammar, skipped when the grammar is not built)"
touches:
  - "63ab54d2-ab85-486b-bb55-dbc313f1d17b"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sourcevision"
  - "java"
source: "ndx-adversarial-review"
---

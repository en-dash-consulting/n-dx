---
id: "9ad52cf9-3451-48de-b65e-7b9dfd98411b"
type: "capability"
title: "Language pack interface inside sourcevision"
slug: "language-pack-interface-inside"
statement: "Sourcevision defines built-in language packs internally, runs their tree-sitter queries to return captures, and checks each pack's output against committed golden files."
criteria: [{"id":"c1","text":"Sourcevision shall type a LanguagePack in src/language/pack.ts with an id, the existing LanguageConfig, a grammar with a pinned version and a locator for the built WASM, named query files, an optional resolver, optional build-file readers, and a provenance record per rule giving the versions verified against, the date verified and the source URL."},{"id":"c2","text":"The LanguagePack type shall reserve optional frameworks and precise (SCIP) slots as types only."},{"id":"c3","text":"The pack loader shall list the built-in packs registered in sourcevision and report, per language, whether its grammar is available."},{"id":"c4","text":"If a pack's grammar is missing, sourcevision shall degrade that language to inventory-only, report this once with a clear message, and continue the analysis."},{"id":"c5","text":"When a language has no pack, sourcevision shall keep handling it through the language registry and detection."},{"id":"c6","text":"The tree-sitter runner shall initialise web-tree-sitter once per process and load each grammar at most once per process, on first use."},{"id":"c7","text":"The tree-sitter runner shall run a pack's named query files on a parsed file and return captures carrying the capture name, node type, text, and start and end line and column."},{"id":"c8","text":"The tree-sitter runner shall report for each parse whether the tree contains ERROR or MISSING nodes."},{"id":"c9","text":"The tree-sitter runner shall free every tree and query object it creates after use."},{"id":"c10","text":"If a file exceeds the size limit, the tree-sitter runner shall skip it without parsing and count it."},{"id":"c11","text":"The fixture harness shall run every built-in pack over its fixture directory and fail on any difference from the committed golden JSON."},{"id":"c12","text":"The fixture harness shall rewrite golden files only when its explicit update command is run, never by default."}]
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
source: "roadmap"
priority: "medium"
---

Milestone L1. Define the internal language-pack contract, a tree-sitter runner and a fixture harness, all inside packages/sourcevision/src/language/. A pack bundles: the existing LanguageConfig (unchanged), a grammar locator, query files, an optional resolver, optional build-file readers, and a provenance record per rule (versions verified against, date verified, source URL). Framework packs and SCIP ingest come in later phases; leave room for them in the type but do not implement them.

No new package and no change to the architecture policy tests: extracting @n-dx/lang-kit waits until roadmap PR 24 merges. No public plugin API and no loading of packs from outside sourcevision.

Phase 1 · one PR · starts only if the runner spike recommends go.

---
id: "45954c7d-9a7d-4c29-a050-32e2657a8414"
level: "task"
title: "Define the language pack type and built-in pack loader"
status: "in_progress"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
source: "roadmap"
startedAt: "2026-10-08T00:44:14.136Z"
acceptanceCriteria:
  - "LanguagePack and its provenance record are typed in src/language/pack.ts"
  - "The loader lists built-in packs and reports grammar availability per language"
  - "A missing grammar degrades that language to inventory-only with a single clear message, and analysis continues"
  - "Unit tests cover a pack with and without its grammar"
description: "Add packages/sourcevision/src/language/pack.ts with a LanguagePack type: id, config (the existing LanguageConfig, unchanged), grammar (pinned version and a locator for the built WASM), queries (named .scm files shipped beside the pack), resolver (optional), buildReaders (optional), and provenance (per rule: verifiedAgainst versions, verifiedOn date, source URL). Reserve optional frameworks and precise (SCIP) slots as types only.\n\nAdd a loader that returns the built-in packs registered in sourcevision and reports, per language, whether its grammar is available. A pack whose grammar is missing degrades to inventory-only for that language and says so once; it never fails the analysis. The registry in language/registry.ts and detect.ts keep working for languages without a pack."
lastModified: "2026-10-08T00:44:14.394Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

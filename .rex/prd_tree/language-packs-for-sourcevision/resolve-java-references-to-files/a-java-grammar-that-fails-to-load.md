---
id: "7fc53a4a-418c-4dfe-bfc0-9f10f2a92181"
level: "task"
title: "A Java grammar that fails to load fails the whole imports phase, including JS/TS edges"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sourcevision"
  - "java"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With an unloadable tree-sitter-java.wasm in grammarDir, analyzeImports on the Java fixture resolves without throwing and returns no Java edges"
  - "That run emits exactly one notice naming the grammar path and the load failure"
  - "A test in tests/unit/analyzers/pack-imports.test.ts or tests/integration/java-zones.test.ts covers the unloadable-grammar case using a non-WASM file in a temp grammarDir"
description: "Verdict: should-fix (medium), introduced by \"Feed Java edges into the analyze pipeline\".\n\nScenario: build/grammars/tree-sitter-java.wasm exists but cannot be loaded — built by an older tree-sitter CLI before a web-tree-sitter upgrade (ABI mismatch), truncated by an interrupted build, or otherwise corrupt. loadLanguagePacks only checks existsSync, so the pack is in \"structure\" mode. buildPackImportGraph (src/analyzers/pack-imports.ts) calls runner.parseSource, and Language.load rejects (src/language/runner.ts loadGrammar → compile). The rejection propagates out of analyzeImports (src/analyzers/imports.ts). analyze-phases.ts records an imports-phase error, so imports.json is not written — for JS/TS/Go edges in the same repo too — and zones run without an import graph. The missing-grammar contract (\"degrade to inventory-only with one message, never fail the analysis\") does not cover a grammar that is present but unloadable.\n\nReachable: `sv analyze` / `ndx analyze` on a Java project after the grammar pin or web-tree-sitter changes without re-running build-grammars.mjs.\n\nOptions:\n1. (Recommended) In buildPackImportGraph, load the grammar once up front (loadGrammar(status.grammarPath)). On failure, emit one notice through the same warn sink naming the path and the error, and treat the pack as inventory-only. Cheap; keeps the one-message contract.\n2. Move the load check into loadLanguagePacks (make it async and return mode \"inventory-only\" with the load error). Cleaner contract, but every caller becomes async.\nPer-file parse errors (`tree-sitter returned no tree`) should probably skip that file, not fail the phase; decide alongside."
lastModified: "2026-10-08T02:30:01.089Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

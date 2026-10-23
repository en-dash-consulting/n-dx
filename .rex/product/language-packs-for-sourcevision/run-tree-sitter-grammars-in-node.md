---
id: "389bb1b2-37c5-47e0-b807-44363f3a48cc"
type: "capability"
title: "Run tree-sitter grammars in Node through WASM"
slug: "run-tree-sitter-grammars-in-node"
statement: "The product parses Java source in Node with web-tree-sitter and a Java grammar built to WASM from a pinned tree-sitter-java release, without a native binding."
criteria: [{"id":"c1","text":"When run on a clean checkout, the grammar build script shall produce tree-sitter-java.wasm in a gitignored directory."},{"id":"c2","text":"The grammar build shall take the tree-sitter-java version and its checksum from a single pinned location."},{"id":"c3","text":"@n-dx/sourcevision shall depend on an exactly pinned version of web-tree-sitter."},{"id":"c4","text":"web-tree-sitter shall load the built Java grammar in Node and parse a small Java class without ERROR nodes."},{"id":"c5","text":"The repository shall contain no committed .wasm file and no native addon for Java parsing."},{"id":"c6","text":"When run against a local directory, the benchmark script shall parse every .java file and print the file count, total and per-file time, files per second, peak memory, and the share of files whose tree contains ERROR or MISSING nodes."},{"id":"c7","text":"The benchmark script shall free each parse tree after use."}]
requirements: [{"id":"389bb1b2-37c5-47e0-b807-44363f3a48cc:c2","title":"The grammar build shall take the tree-sitter-java version and its checksum from a single pinned location","description":"Linked to: packages/lang-java/tests/unit/java-grammar-pin.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The grammar build shall take the tree-sitter-java version and its checksum from a single pinned location."]},{"id":"389bb1b2-37c5-47e0-b807-44363f3a48cc:c4","title":"web-tree-sitter shall load the built Java grammar in Node and parse a small Java class without ERROR nodes","description":"Linked to: packages/lang-java/tests/integration/tree-sitter-java-grammar.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["web-tree-sitter shall load the built Java grammar in Node and parse a small Java class without ERROR nodes."]}]
tags:
  - "language-packs"
  - "phase-1"
  - "spike"
  - "sourcevision"
source: "roadmap"
priority: "medium"
---

Spike (milestone L0). Prove that web-tree-sitter plus a Java grammar built to WASM from a pinned release runs in Node on macOS, Linux and Windows, and measure whether it is fast enough for large repos. The result is a go or no-go for the runner that every later pack uses.

Phase 1 · one PR · gate G1 is measured at the end of the Java structure feature.

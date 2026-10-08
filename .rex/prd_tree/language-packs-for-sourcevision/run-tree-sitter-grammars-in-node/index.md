---
id: "389bb1b2-37c5-47e0-b807-44363f3a48cc"
level: "feature"
title: "Run tree-sitter grammars in Node through WASM"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "spike"
  - "sourcevision"
source: "roadmap"
acceptanceCriteria:
  - "A script builds the Java grammar WASM from a pinned tree-sitter-java release without a native compiler on the developer machine, or the rex log states exactly which toolchain the build needs and why"
  - "web-tree-sitter loads the built grammar in Node and parses a Java file in a vitest test"
  - "Parse throughput (files per second, total time) and peak memory on at least one large Spring Boot repository are recorded in the rex log with a go or no-go recommendation"
  - "No .wasm file is committed and no native binding is added"
description: "Spike (milestone L0). Prove that web-tree-sitter plus a Java grammar built to WASM from a pinned release runs in Node on macOS, Linux and Windows, and measure whether it is fast enough for large repos. The result is a go or no-go for the runner that every later pack uses.\n\nPhase 1 · one PR · gate G1 is measured at the end of the Java structure feature."
lastModified: "2026-10-08T00:04:13.808Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Build the Java grammar to WASM from a pinned release](./build-the-java-grammar-to-wasm-from-a.md) | completed |
| [Measure Java parse throughput on large repositories](./measure-java-parse-throughput-on-large.md) | pending |

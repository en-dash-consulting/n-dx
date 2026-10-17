---
id: "55f064ef-c74a-4c5f-b006-5286ce0f42cf"
level: "feature"
title: "Java structure through tree-sitter"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "java"
blockedBy:
  - "9ad52cf9-3451-48de-b65e-7b9dfd98411b"
source: "roadmap"
startedAt: "2026-10-08T02:02:25.148Z"
endedAt: "2026-10-17T01:29:34.256Z"
acceptanceCriteria:
  - "java is a valid language id and Java repositories are detected"
  - "Java files get roles in the inventory (source, test, generated, config) from the Java LanguageConfig"
  - "Java query goldens cover packages, single, wildcard and static imports, nested types, records, enums, annotations, methods with spans, calls and type references"
  - "On the drift corpus, at least 98% of .java files parse without ERROR or MISSING nodes, measured and recorded in the rex log"
  - "Analysis output for non-Java fixtures is unchanged"
description: "Milestone L2. The first pack: Java is recognised as a language, its files get roles in the inventory, and the Java queries extract packages, imports, type declarations, method spans, method calls and type references. No import resolution yet (that is the next feature), so the import graph for Java repos is unchanged in this PR.\n\nSeeds the drift corpus: pinned public repositories used to measure the pack now and to catch grammar or rule drift later.\n\nPhase 1 · one PR · gate G1: at least 98% of .java files in the drift corpus parse without ERROR or MISSING nodes."
lastModified: "2026-10-17T01:46:00.037Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Build the tree-sitter grammars in CI's test job so grammar-gated tests run](./build-the-tree-sitter-grammars-in-ci-s.md) | completed |
| [CI never builds the Java grammar, so every grammar-dependent runner and grammar test skips there and the runner's acceptance criteria are unverified in CI](./ci-never-builds-the-java-grammar-so.md) | completed |
| [Java structure-queries changeset says analysis output is unchanged while the stack adds Java edges](./java-structure-queries-changeset-says.md) | in_progress |
| [Language-pack fixtures and goldens are not pinned to LF, so a Windows CRLF checkout fails the golden comparison](./language-pack-fixtures-and-goldens-are.md) | completed |
| [Register Java as a language with inventory roles](./register-java-as-a-language-with.md) | completed |
| [Seed the Java drift corpus and measure the parse rate](./seed-the-java-drift-corpus-and-measure.md) | completed |
| [Write the Java structure queries with goldens](./write-the-java-structure-queries-with.md) | completed |

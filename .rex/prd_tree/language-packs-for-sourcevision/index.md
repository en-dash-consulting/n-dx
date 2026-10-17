---
id: "58f0468b-33ce-46ee-b507-c95261f152b6"
level: "epic"
title: "Language packs for sourcevision"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "sourcevision"
  - "java"
  - "lane-models-analysis"
source: "roadmap"
description: "Replace hand-written per-language parsers with language packs: a tree-sitter grammar (built to WASM from a pinned release) plus query files for structure, a resolver per ecosystem, and framework rules. Java is the first pack. This epic covers phases 1 and 2 only (prove the runner; Java resolves). Phase 3 (Spring Boot rules into outbound.json / infrastructure.json, ecosystem facts) waits on a conversation with Sterling H about the cross-repo meta-scan and readiness artifacts, and phase 4 (package extraction, SCIP ingest, drift CI, Go port) comes after the 1.0.0 cut.\n\nDecided 2026-10-07: tree-sitter is the default structure layer and SCIP an optional precise tier (LS1); the pack interface is internal and there is no public plugin API until after 1.0 (LS2); no reference documentation ships in any pack, and versions, end-of-life and vulnerabilities come only from live datasets later (LS3); models judge over injected facts and never assert versions from memory (LS4); no C# work until a client has a C# codebase (LS5).\n\nRules for every task in this epic, from the 1.0.0 conflict check:\n- Stay inside sourcevision: src/language/**, new Java analyzers, fixtures and scripts. No new package (the pack interface stays inside sourcevision until roadmap PR 24 merges), no edits to core/cli.js, rex, hench, the layout path modules or project-profile.ts.\n- Do not change sourcevision MCP tool names, required parameters or response shapes. Only optional new fields, and only when a task says so.\n- Any cache or scratch path goes through the sourcevision paths module and is machine-local; nothing new is committed under .sourcevision/ or .ndx/.\n- Analysis output for TypeScript, JavaScript, Go, Swift and Python repos must not change.\n- Grammar WASM is built from a pinned grammar release; no native node-gyp binding (tree-sitter-java on npm ships only a native binding) and no committed .wasm.\n- Measurements a task asks for (throughput, parse rate, precision and recall) go in the task's rex log with append_log, so the operator can copy them into the PR description.\n- Before finishing, run the six static root policy tests, which are easy to miss: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js and obfuscated-code-policy.test.js (about 2 s together).\n\nWork lands as stacked PRs, one per feature, each branched from the previous feature's branch.\n\nRoadmap and conflict check: https://claude.ai/artifact/V9Gir7zb6MhmEgSLJ1F1Pk"
lastModified: "2026-10-08T00:04:12.769Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Go structure through tree-sitter](./go-structure-through-tree-sitter/index.md) | completed |
| [Java structure through tree-sitter](./java-structure-through-tree-sitter/index.md) | completed |
| [Language pack interface inside sourcevision](./language-pack-interface-inside/index.md) | completed |
| [Read Maven and Gradle build files](./read-maven-and-gradle-build-files/index.md) | completed |
| [Resolve Go imports through the pack](./resolve-go-imports-through-the-pack/index.md) | completed |
| [Resolve Java references to files](./resolve-java-references-to-files/index.md) | completed |
| [Review follow-ups for language packs](./review-follow-ups-for-language-packs/index.md) | pending |
| [Run tree-sitter grammars in Node through WASM](./run-tree-sitter-grammars-in-node/index.md) | completed |
| [SQL dialects and database signals](./sql-dialects-and-database-signals/index.md) | pending |
| [Terraform structure through tree-sitter-hcl](./terraform-structure-through-tree/index.md) | pending |

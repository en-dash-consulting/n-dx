---
id: "f522e7ae-44aa-458b-80ef-7a1132416c0c"
level: "feature"
title: "Resolve Java references to files"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
blockedBy:
  - "55f064ef-c74a-4c5f-b006-5286ce0f42cf"
source: "roadmap"
acceptanceCriteria:
  - "Java repositories produce import edges and zones through the normal analyze pipeline"
  - "Single-type, wildcard, static and same-package references resolve to files; unresolved references to other packages become external imports attributed by package prefix"
  - "Multi-module Maven and Gradle repositories resolve across modules"
  - "Precision and recall against scip-java on the drift corpus are measured and recorded in the rex log"
  - "Analysis output for non-Java fixtures is unchanged"
description: "Milestone L3. Turn Java captures into the import graph sourcevision already uses, so Java repositories get zones, cohesion, coupling and findings like TypeScript and Go. Java needs no import for a class in the same package, so an import-only graph misses edges; the resolver keeps a per-package type index for bare type names.\n\nEdges use the existing ImportEdge and ExternalImport shapes. No new required fields and no change to sourcevision MCP tool shapes. Accuracy is measured against scip-java on the drift corpus, where scip-java serves as the answer key; scip-java is a manual measurement tool here, not a runtime dependency.\n\nPhase 2 · one PR · gate G2 (resolver measured)."
lastModified: "2026-10-08T00:04:17.937Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Discover Java modules and source roots](./discover-java-modules-and-source-roots.md) | completed |
| [Feed Java edges into the analyze pipeline](./feed-java-edges-into-the-analyze.md) | pending |
| [Include Java in multi-language detection beside other build markers](./include-java-in-multi-language.md) | pending |
| [Java resolver scans every qualified type span for each type name, quadratic on large generated files](./java-resolver-scans-every-qualified.md) | pending |
| [Measure Java resolver accuracy against scip-java](./measure-java-resolver-accuracy-against.md) | pending |
| [Published sourcevision has no grammars, so every language pack degrades to inventory-only and the notice points at an unshipped script](./published-sourcevision-has-no-grammars.md) | pending |
| [Resolve Java imports and same-package references](./resolve-java-imports-and-same-package.md) | completed |

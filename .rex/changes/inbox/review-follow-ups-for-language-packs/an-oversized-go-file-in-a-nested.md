---
id: "e894d040-e93a-4d12-9f56-1a48e6af22eb"
type: "task"
title: "An oversized Go file in a nested module or go.work project gets its internal imports as externals"
slug: "an-oversized-go-file-in-a-nested"
description: "Found by the adversarial review of f9b53844 (verdict: should-fix, severity low).\n\nScenario: a go.work project (or nested modules with no root go.mod) holds a Go file over the runner's 1 MB limit, e.g. api/zz_generated.openapi.go importing example.com/ws/api/internal/store. The pack lists it as unparsed, and analyzeImports (packages/sourcevision/src/analyzers/imports.ts, the processGoFiles call after buildPackImportGraph) runs extractGoImports with the root go.mod's module path only. Its internal imports become third-party externals instead of edges. An import of the module's root package becomes an edge to \"\", which matches no file. Those are the deliberate differences the pack's resolver fixes, but they still apply to oversized files. Single-module projects are unaffected.\n\nReachable: `sv analyze` on any multi-module Go repo with a generated file over 1 MB.\n\nOptions:\n(a) Recommended: inside lang-go/lang-runtime, have the pack read an oversized file's import block with a cheap text scan, or parse only its prefix up to the import declarations, and resolve it through the Go resolver. Then sourcevision needs no fallback for it. Cost: moderate; the runner's size contract changes.\n(b) Pass extractGoImports the nearest go.mod's module path per file. This is cheaper but still misses go.work and replaces."
acceptanceCriteria:
  - "In a go.work fixture, a Go file over the pack's size limit that imports a package of a workspace module gets an edge to that package directory, not an external"
  - "An oversized file importing its module's root package gets edges to the root package's non-test files, never an edge to \"\""
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-go"
  - "sourcevision"
source: "ndx-adversarial-review"
---

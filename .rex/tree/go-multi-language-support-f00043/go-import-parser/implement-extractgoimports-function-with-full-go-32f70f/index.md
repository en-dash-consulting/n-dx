---
id: "32f70fa2-70d8-4b26-98a1-e54baeccbf97"
level: "task"
title: "Implement extractGoImports function with full Go import syntax coverage"
status: "completed"
priority: "critical"
tags:
  - "go"
  - "sourcevision"
  - "imports"
  - "parser"
source: "smart-add"
startedAt: "2026-03-26T05:01:09.933Z"
completedAt: "2026-03-26T05:07:17.320Z"
acceptanceCriteria:
  - "Single-line import statements (import \"fmt\") are parsed and classified correctly"
  - "Grouped import blocks with all syntax variants are fully parsed"
  - "Aliased imports extract both the alias and underlying package path"
  - "Blank imports (_ \"pkg\") are classified as external packages without crashing"
  - "Dot imports (. \"pkg\") are extracted and classified correctly"
  - "go.mod is read and the module path is extracted before import classification"
  - "Stdlib imports are classified as external with a stdlib: prefix"
  - "Third-party imports are classified as external"
  - "Internal imports produce import edges resolved to relative directory paths"
  - "All produced edges carry ImportType.static"
  - "Comment lines inside grouped import blocks do not produce false edges"
  - "String literals in non-import source code containing import-like text do not produce false edges"
description: "Create packages/sourcevision/src/analyzers/go-imports.ts with an extractGoImports(sourceText, filePath) function. Reads go.mod once to extract the module path and classifies each import as stdlib (no domain prefix, e.g. fmt, net/http), third-party (has domain, e.g. github.com/go-chi/chi), or internal (starts with module path). Handles single imports, grouped import blocks, aliased imports (alias \"pkg\"), blank imports (_ \"pkg\"), and dot imports (. \"pkg\"). Internal imports resolve to relative directory paths as import edges. All Go imports use ImportType.static."
---

# Implement extractGoImports function with full Go import syntax coverage

🔴 [completed]

## Summary

Create packages/sourcevision/src/analyzers/go-imports.ts with an extractGoImports(sourceText, filePath) function. Reads go.mod once to extract the module path and classifies each import as stdlib (no domain prefix, e.g. fmt, net/http), third-party (has domain, e.g. github.com/go-chi/chi), or internal (starts with module path). Handles single imports, grouped import blocks, aliased imports (alias "pkg"), blank imports (_ "pkg"), and dot imports (. "pkg"). Internal imports resolve to relative directory paths as import edges. All Go imports use ImportType.static.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** go, sourcevision, imports, parser
- **Level:** task
- **Started:** 2026-03-26T05:01:09.933Z
- **Completed:** 2026-03-26T05:07:17.320Z
- **Duration:** 6m

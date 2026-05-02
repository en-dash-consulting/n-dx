---
id: "19509120-0d5b-4aac-a83e-2b200ed8aabf"
level: "task"
title: "Modify imports.ts to route .go files to the Go import parser"
status: "completed"
priority: "critical"
tags:
  - "go"
  - "sourcevision"
  - "imports"
  - "dispatch"
source: "smart-add"
startedAt: "2026-03-26T05:15:49.167Z"
completedAt: "2026-03-26T05:24:08.530Z"
acceptanceCriteria:
  - ".go files are routed to extractGoImports and not the JS/TS parser"
  - "go.mod is read exactly once per analyzeImports call, not once per .go file"
  - "Internal Go import edges use directory paths (e.g. cmd/api/main.go → internal/handler/)"
  - "JS/TS files continue to be processed by the existing parser with no regression"
  - "Language dispatch reads manifest.language or uses detectLanguage from the language registry"
  - "A mixed-language project directory does not crash or produce cross-language edge contamination"
  - "go.mod is not read when no .go files are present in the scanned directory"
description: "Expand or replace the JS_TS_EXTENSIONS gate in packages/sourcevision/src/analyzers/imports.ts to include .go files, or replace the check with the language registry's parseableExtensions. The analyzeImports function reads go.mod once per invocation (not per-file) and passes the extracted module path to extractGoImports for each .go file. Internal Go import edges resolve to directory paths (file-to-package rather than file-to-file). Language is determined from manifest.language or via detectLanguage from the language registry. JS/TS dispatch must remain unchanged."
---

# Modify imports.ts to route .go files to the Go import parser

🔴 [completed]

## Summary

Expand or replace the JS_TS_EXTENSIONS gate in packages/sourcevision/src/analyzers/imports.ts to include .go files, or replace the check with the language registry's parseableExtensions. The analyzeImports function reads go.mod once per invocation (not per-file) and passes the extracted module path to extractGoImports for each .go file. Internal Go import edges resolve to directory paths (file-to-package rather than file-to-file). Language is determined from manifest.language or via detectLanguage from the language registry. JS/TS dispatch must remain unchanged.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** go, sourcevision, imports, dispatch
- **Level:** task
- **Started:** 2026-03-26T05:15:49.167Z
- **Completed:** 2026-03-26T05:24:08.530Z
- **Duration:** 8m

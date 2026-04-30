---
id: "e27102cc-3e46-4c45-a124-0ba8c56fa1b4"
level: "task"
title: "Refactor inventory.ts to consume language registry"
status: "completed"
priority: "critical"
tags:
  - "sourcevision"
  - "go"
  - "inventory"
  - "refactor"
source: "smart-add"
startedAt: "2026-03-25T20:37:22.910Z"
completedAt: "2026-03-25T20:54:29.154Z"
acceptanceCriteria:
  - "inventory.ts imports from packages/sourcevision/src/language/ and uses languageConfig.skipDirectories instead of hardcoded SKIP_DIRS"
  - "inventory.ts uses languageConfig.configFilenames instead of hardcoded CONFIG_FILENAMES"
  - "Files matching languageConfig.testFilePatterns receive role 'test' in inventory output"
  - "Files matching languageConfig.generatedFilePatterns receive role 'generated' in inventory output"
  - "Files under testdata/ directories receive role 'asset'"
  - "All existing inventory unit tests pass without modification (JS/TS behavior unchanged)"
  - "Running sourcevision analyze on a JS/TS project produces identical inventory.json output before and after this change (no regression)"
description: "Update packages/sourcevision/src/analyzers/inventory.ts to replace all hardcoded SKIP_DIRS and CONFIG_FILENAMES constants with values from the language registry. Add Go-specific role classification: _test.go files → role 'test', generated file patterns (_gen.go, .pb.go, wire_gen.go, mock_*.go) → role 'generated', testdata/ contents → role 'asset', cmd/*/main.go → role 'source' (entrypoint archetype applied later). The language is resolved once per analysis run via detectLanguage() and threaded through the analyzer."
---

# Refactor inventory.ts to consume language registry

🔴 [completed]

## Summary

Update packages/sourcevision/src/analyzers/inventory.ts to replace all hardcoded SKIP_DIRS and CONFIG_FILENAMES constants with values from the language registry. Add Go-specific role classification: _test.go files → role 'test', generated file patterns (_gen.go, .pb.go, wire_gen.go, mock_*.go) → role 'generated', testdata/ contents → role 'asset', cmd/*/main.go → role 'source' (entrypoint archetype applied later). The language is resolved once per analysis run via detectLanguage() and threaded through the analyzer.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** sourcevision, go, inventory, refactor
- **Level:** task
- **Started:** 2026-03-25T20:37:22.910Z
- **Completed:** 2026-03-25T20:54:29.154Z
- **Duration:** 17m

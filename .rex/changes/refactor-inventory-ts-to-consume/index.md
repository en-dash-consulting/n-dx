---
id: "e27102cc-3e46-4c45-a124-0ba8c56fa1b4"
type: "change"
title: "Refactor inventory.ts to consume language registry"
slug: "refactor-inventory-ts-to-consume"
intent: "Update packages/sourcevision/src/analyzers/inventory.ts to replace all hardcoded SKIP_DIRS and CONFIG_FILENAMES constants with values from the language registry. Add Go-specific role classification: _test.go files → role 'test', generated file patterns (_gen.go, .pb.go, wire_gen.go, mock_*.go) → role 'generated', testdata/ contents → role 'asset', cmd/*/main.go → role 'source' (entrypoint archetype applied later). The language is resolved once per analysis run via detectLanguage() and threaded through the analyzer."
acceptanceCriteria:
  - "inventory.ts imports from packages/sourcevision/src/language/ and uses languageConfig.skipDirectories instead of hardcoded SKIP_DIRS"
  - "inventory.ts uses languageConfig.configFilenames instead of hardcoded CONFIG_FILENAMES"
  - "Files matching languageConfig.testFilePatterns receive role 'test' in inventory output"
  - "Files matching languageConfig.generatedFilePatterns receive role 'generated' in inventory output"
  - "Files under testdata/ directories receive role 'asset'"
  - "All existing inventory unit tests pass without modification (JS/TS behavior unchanged)"
  - "Running sourcevision analyze on a JS/TS project produces identical inventory.json output before and after this change (no regression)"
touches:
  - "956b7119-989e-41f1-ba0e-3e8d26494fee"
priority: "critical"
tags:
  - "sourcevision"
  - "go"
  - "inventory"
  - "refactor"
source: "smart-add"
---

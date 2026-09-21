---
id: "67760efe-1f60-4c4a-9018-d5231486b081"
level: "task"
title: "Implement language registry module in sourcevision"
status: "completed"
priority: "critical"
tags:
  - "sourcevision"
  - "go"
  - "language-registry"
source: "smart-add"
startedAt: "2026-03-25T20:23:35.621Z"
completedAt: "2026-03-25T20:35:14.515Z"
acceptanceCriteria:
  - "packages/sourcevision/src/language/registry.ts exports LanguageConfig interface with all fields from spec (id, displayName, extensions, parseableExtensions, testFilePatterns, configFilenames, skipDirectories, generatedFilePatterns, entryPointPatterns, moduleFile)"
  - "packages/sourcevision/src/language/go.ts exports a LanguageConfig that includes vendor/ in skipDirectories, _test.go in testFilePatterns, .go in extensions, and go.mod as moduleFile"
  - "packages/sourcevision/src/language/typescript.ts exports a LanguageConfig whose skipDirectories and configFilenames match the current hardcoded values in inventory.ts"
  - "packages/sourcevision/src/language/detect.ts implements the five-step detection chain: .n-dx.json override → go.mod → package.json → file-count tiebreak → JS/TS fallback"
  - "detect.ts returns the TS/JS config for a project with no go.mod (backward-compatible fallback)"
  - "detect.ts returns the Go config for a project with go.mod and no package.json"
  - "All four files are re-exported from a language/index.ts barrel"
description: "Create packages/sourcevision/src/language/ with four files: registry.ts (LanguageConfig interface), go.ts (Go language config: extensions, skipDirectories including vendor/, testFilePatterns for _test.go, generatedFilePatterns for _gen.go/_pb.go/wire_gen.go, configFilenames for go.mod/go.sum/.golangci.yml, entryPointPatterns), typescript.ts (extract existing JS/TS hardcoded constants into registry shape), and detect.ts (auto-detection: check .n-dx.json override → go.mod → package.json → file-count tiebreak → fallback to JS/TS). The registry becomes the single source of truth for all downstream language-specific decisions."
---

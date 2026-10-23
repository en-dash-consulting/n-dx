---
id: "67760efe-1f60-4c4a-9018-d5231486b081"
type: "change"
title: "Implement language registry module in sourcevision"
slug: "implement-language-registry-module-in"
intent: "Create packages/sourcevision/src/language/ with four files: registry.ts (LanguageConfig interface), go.ts (Go language config: extensions, skipDirectories including vendor/, testFilePatterns for _test.go, generatedFilePatterns for _gen.go/_pb.go/wire_gen.go, configFilenames for go.mod/go.sum/.golangci.yml, entryPointPatterns), typescript.ts (extract existing JS/TS hardcoded constants into registry shape), and detect.ts (auto-detection: check .n-dx.json override → go.mod → package.json → file-count tiebreak → fallback to JS/TS). The registry becomes the single source of truth for all downstream language-specific decisions."
acceptanceCriteria:
  - "packages/sourcevision/src/language/registry.ts exports LanguageConfig interface with all fields from spec (id, displayName, extensions, parseableExtensions, testFilePatterns, configFilenames, skipDirectories, generatedFilePatterns, entryPointPatterns, moduleFile)"
  - "packages/sourcevision/src/language/go.ts exports a LanguageConfig that includes vendor/ in skipDirectories, _test.go in testFilePatterns, .go in extensions, and go.mod as moduleFile"
  - "packages/sourcevision/src/language/typescript.ts exports a LanguageConfig whose skipDirectories and configFilenames match the current hardcoded values in inventory.ts"
  - "packages/sourcevision/src/language/detect.ts implements the five-step detection chain: .n-dx.json override → go.mod → package.json → file-count tiebreak → JS/TS fallback"
  - "detect.ts returns the TS/JS config for a project with no go.mod (backward-compatible fallback)"
  - "detect.ts returns the Go config for a project with go.mod and no package.json"
  - "All four files are re-exported from a language/index.ts barrel"
amends: [{"target":"956b7119-989e-41f1-ba0e-3e8d26494fee","delta":"modified","summary":"Implement language registry module in sourcevision","base":"c68a1a9c5723611e7cee5fd68523e92767519ede671d838534f45c961a7f1009"}]
priority: "critical"
tags:
  - "sourcevision"
  - "go"
  - "language-registry"
source: "smart-add"
---

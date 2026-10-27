---
id: "ea5ba3f2-4f9e-46b1-9874-23bdc62f8130"
type: "change"
title: "Make Hench agent prompts language-aware for Go projects"
slug: "make-hench-agent-prompts-language"
intent: "Modify `packages/hench/src/agent/planning/prompt.ts` to include Go-specific context in the task brief when the project language is Go. Language detection uses `manifest.language` from `.sourcevision/` or go.mod presence. Go briefs replace JS/TS toolchain references with Go equivalents and add Go-specific naming, structure, and test conventions without altering the JS/TS prompt path."
acceptanceCriteria:
  - "Go project briefs reference `go test ./...` instead of `npm test` or `vitest`"
  - "Go project briefs reference `go build ./...` for build verification"
  - "Go project briefs reference `go vet ./...` and `golangci-lint run` for linting"
  - "Go project briefs reference Go naming conventions: exported = PascalCase, unexported = camelCase, error handling via explicit returns (no try/catch)"
  - "Go project briefs reference Go project structure: `cmd/` for binaries, `internal/` for private packages, `pkg/` for public packages"
  - "Go project briefs reference Go test conventions: `_test.go` suffix, `testing.T` parameter, table-driven tests"
  - "JS/TS project briefs are completely unchanged"
  - "Language detection uses manifest.language or go.mod presence"
  - "The prompt includes language context only when language is detected, not hardcoded"
touches:
  - "8ae4d60a-f66a-40aa-afd7-dac7562ec263"
priority: "medium"
tags:
  - "hench"
  - "go"
  - "prompts"
source: "smart-add"
---

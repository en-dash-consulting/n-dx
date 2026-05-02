---
id: "ea5ba3f2-4f9e-46b1-9874-23bdc62f8130"
level: "task"
title: "Make Hench agent prompts language-aware for Go projects"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "go"
  - "prompts"
source: "smart-add"
startedAt: "2026-03-26T14:59:05.256Z"
completedAt: "2026-03-26T15:05:23.743Z"
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
description: "Modify `packages/hench/src/agent/planning/prompt.ts` to include Go-specific context in the task brief when the project language is Go. Language detection uses `manifest.language` from `.sourcevision/` or go.mod presence. Go briefs replace JS/TS toolchain references with Go equivalents and add Go-specific naming, structure, and test conventions without altering the JS/TS prompt path."
---

# Make Hench agent prompts language-aware for Go projects

🟡 [completed]

## Summary

Modify `packages/hench/src/agent/planning/prompt.ts` to include Go-specific context in the task brief when the project language is Go. Language detection uses `manifest.language` from `.sourcevision/` or go.mod presence. Go briefs replace JS/TS toolchain references with Go equivalents and add Go-specific naming, structure, and test conventions without altering the JS/TS prompt path.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** hench, go, prompts
- **Level:** task
- **Started:** 2026-03-26T14:59:05.256Z
- **Completed:** 2026-03-26T15:05:23.743Z
- **Duration:** 6m

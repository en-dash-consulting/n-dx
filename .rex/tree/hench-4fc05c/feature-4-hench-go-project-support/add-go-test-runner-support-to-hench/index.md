---
id: "a6862705-ed72-4d1a-aab7-090c85e50582"
level: "task"
title: "Add Go test runner support to Hench"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "go"
  - "test-runner"
source: "smart-add"
startedAt: "2026-03-26T06:28:00.347Z"
completedAt: "2026-03-26T06:35:25.306Z"
acceptanceCriteria:
  - "_test.go files are recognized by isTestFile()"
  - "candidateTestPaths(\"internal/handler/user.go\") includes \"internal/handler/user_test.go\""
  - "Go test runner is detected from \"go test\" command string"
  - "Scoped Go test command is correctly formatted: `go test ./internal/handler/...` for targeted packages"
  - "Full Go test command is `go test ./...` when scoping is not possible"
  - "Existing JS/TS test runner behavior is completely unchanged"
  - "All existing test-runner tests pass"
description: "Modify `packages/hench/src/tools/test-runner.ts` to recognize `_test.go` files, generate scoped Go test commands by mapping test file directories to package paths (e.g., `internal/handler/user_test.go` → `go test ./internal/handler/...`), and resolve test file candidates using Go's `_test.go` naming convention (same directory, different suffix from `.test.ts`)."
---

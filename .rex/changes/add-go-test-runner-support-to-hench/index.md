---
id: "a6862705-ed72-4d1a-aab7-090c85e50582"
type: "change"
title: "Add Go test runner support to Hench"
slug: "add-go-test-runner-support-to-hench"
intent: "Modify `packages/hench/src/tools/test-runner.ts` to recognize `_test.go` files, generate scoped Go test commands by mapping test file directories to package paths (e.g., `internal/handler/user_test.go` → `go test ./internal/handler/...`), and resolve test file candidates using Go's `_test.go` naming convention (same directory, different suffix from `.test.ts`)."
acceptanceCriteria:
  - "_test.go files are recognized by isTestFile()"
  - "candidateTestPaths(\"internal/handler/user.go\") includes \"internal/handler/user_test.go\""
  - "Go test runner is detected from \"go test\" command string"
  - "Scoped Go test command is correctly formatted: `go test ./internal/handler/...` for targeted packages"
  - "Full Go test command is `go test ./...` when scoping is not possible"
  - "Existing JS/TS test runner behavior is completely unchanged"
  - "All existing test-runner tests pass"
amends: [{"target":"8ae4d60a-f66a-40aa-afd7-dac7562ec263","delta":"modified","summary":"Add Go test runner support to Hench","base":"35095ea7bcb7ca56a9222ffa6a5b2b794bfbde0b9bd4698e9bc0ab3f364e9a44"}]
priority: "high"
tags:
  - "hench"
  - "go"
  - "test-runner"
source: "smart-add"
---

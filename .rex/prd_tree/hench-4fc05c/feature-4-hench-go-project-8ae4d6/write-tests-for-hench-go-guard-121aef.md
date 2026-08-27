---
id: "121aefae-1c0b-4f83-b83c-fe972d76a29d"
level: "task"
title: "Write tests for Hench Go guard defaults, test runner, and language-aware prompts"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "go"
  - "testing"
source: "smart-add"
startedAt: "2026-03-26T15:09:02.409Z"
completedAt: "2026-03-26T15:14:41.351Z"
acceptanceCriteria:
  - "Tests verify Go allowedCommands defaults"
  - "Tests verify Go blockedPaths include vendor/**"
  - "Tests verify _test.go is recognized as a test file"
  - "Tests verify Go test path candidate generation"
  - "Tests verify Go scoped test command formatting"
  - "Tests verify Go prompt includes Go-specific context"
  - "Tests verify JS/TS prompt is unchanged when project is not Go"
  - "All tests pass with zero failures"
description: "Create tests covering all three Hench Go support areas: guard defaults for Go projects, Go test runner behavior (file recognition, path candidate generation, scoped command formatting), and Go-specific prompt content. Tests must also verify that JS/TS behavior is unchanged across all three areas as a regression guard."
---

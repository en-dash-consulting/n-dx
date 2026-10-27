---
id: "121aefae-1c0b-4f83-b83c-fe972d76a29d"
type: "change"
title: "Write tests for Hench Go guard defaults, test runner, and language-aware prompts"
slug: "write-tests-for-hench-go-guard"
intent: "Create tests covering all three Hench Go support areas: guard defaults for Go projects, Go test runner behavior (file recognition, path candidate generation, scoped command formatting), and Go-specific prompt content. Tests must also verify that JS/TS behavior is unchanged across all three areas as a regression guard."
acceptanceCriteria:
  - "Tests verify Go allowedCommands defaults"
  - "Tests verify Go blockedPaths include vendor/**"
  - "Tests verify _test.go is recognized as a test file"
  - "Tests verify Go test path candidate generation"
  - "Tests verify Go scoped test command formatting"
  - "Tests verify Go prompt includes Go-specific context"
  - "Tests verify JS/TS prompt is unchanged when project is not Go"
  - "All tests pass with zero failures"
touches:
  - "8ae4d60a-f66a-40aa-afd7-dac7562ec263"
priority: "medium"
tags:
  - "hench"
  - "go"
  - "testing"
source: "smart-add"
---

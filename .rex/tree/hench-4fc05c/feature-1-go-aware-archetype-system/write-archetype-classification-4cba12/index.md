---
id: "4cba126c-e847-4510-8f4f-09e3272fb552"
level: "task"
title: "Write archetype classification tests for Go projects"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "archetypes"
  - "testing"
source: "smart-add"
startedAt: "2026-03-26T08:01:03.567Z"
completedAt: "2026-03-26T08:06:08.766Z"
acceptanceCriteria:
  - "Tests verify cmd/api/main.go matches entrypoint archetype"
  - "Tests verify internal/handler/user.go matches route-handler archetype"
  - "Tests verify internal/config/config.go matches config archetype"
  - "Tests verify testdata/ files match test-helper archetype"
  - "Tests verify internal/service/user.go matches service archetype"
  - "Tests verify React archetypes (route-module, component, hook, page) do not match any Go fixture files"
  - "Tests verify that existing JS/TS archetype signals still match correctly (regression guard)"
  - "All tests pass with zero failures"
description: "Create `packages/sourcevision/tests/unit/analyzers/go-archetypes.test.ts` validating archetype signal matching against Go fixture files. Tests must guard against both false positives (React archetypes firing on Go files) and false negatives (Go archetypes missing expected files), and serve as a regression guard for the JS/TS classification path."
---

# Write archetype classification tests for Go projects

🟠 [completed]

## Summary

Create `packages/sourcevision/tests/unit/analyzers/go-archetypes.test.ts` validating archetype signal matching against Go fixture files. Tests must guard against both false positives (React archetypes firing on Go files) and false negatives (Go archetypes missing expected files), and serve as a regression guard for the JS/TS classification path.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** sourcevision, go, archetypes, testing
- **Level:** task
- **Started:** 2026-03-26T08:01:03.567Z
- **Completed:** 2026-03-26T08:06:08.766Z
- **Duration:** 5m

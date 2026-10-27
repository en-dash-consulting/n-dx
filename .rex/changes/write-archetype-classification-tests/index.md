---
id: "4cba126c-e847-4510-8f4f-09e3272fb552"
type: "change"
title: "Write archetype classification tests for Go projects"
slug: "write-archetype-classification-tests"
intent: "Create `packages/sourcevision/tests/unit/analyzers/go-archetypes.test.ts` validating archetype signal matching against Go fixture files. Tests must guard against both false positives (React archetypes firing on Go files) and false negatives (Go archetypes missing expected files), and serve as a regression guard for the JS/TS classification path."
acceptanceCriteria:
  - "Tests verify cmd/api/main.go matches entrypoint archetype"
  - "Tests verify internal/handler/user.go matches route-handler archetype"
  - "Tests verify internal/config/config.go matches config archetype"
  - "Tests verify testdata/ files match test-helper archetype"
  - "Tests verify internal/service/user.go matches service archetype"
  - "Tests verify React archetypes (route-module, component, hook, page) do not match any Go fixture files"
  - "Tests verify that existing JS/TS archetype signals still match correctly (regression guard)"
  - "All tests pass with zero failures"
touches:
  - "c9447ae6-7521-40b0-997d-b56bfaa1993a"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "archetypes"
  - "testing"
source: "smart-add"
---

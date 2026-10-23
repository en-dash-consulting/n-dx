---
id: "49bff344-1bbe-4196-9a38-a507b841960c"
type: "change"
title: "Write unit tests for Go route detection"
slug: "write-unit-tests-for-go-route-detection"
intent: "Create `packages/sourcevision/tests/unit/analyzers/go-route-detection.test.ts` covering all six framework patterns. Tests verify method extraction, path extraction (including parametrized paths), route grouping by file, and false-positive safety for comments and non-route string literals."
acceptanceCriteria:
  - "Tests cover all six frameworks (net/http, chi, gin, echo, fiber, gorilla/mux)"
  - "Tests verify correct HTTP method extraction for each framework"
  - "Tests verify correct path extraction including parameters ({id}, :id)"
  - "Tests verify route grouping by file"
  - "Tests verify comments and non-route string literals do not produce false positives"
  - "Tests verify empty files and files with no routes return empty arrays"
  - "All tests pass with zero failures"
touches:
  - "4a348f37-2be0-4808-a5f4-ae265c10b7b6"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "routes"
  - "testing"
source: "smart-add"
---

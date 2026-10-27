---
id: "9311f36a-e0e4-4275-90f7-badca8d60ee6"
type: "change"
title: "Update unit test callers to use shared utilities"
slug: "update-unit-test-callers-to-use-shared"
intent: "Refactor existing unit test files to consume the new shared helpers and constants while preserving existing assertions, names, and suite intent."
acceptanceCriteria:
  - "No assertions, test names, or suite coverage are removed as part of the consolidation"
  - "The number of discovered tests before and after the refactor is identical"
touches:
  - "f9b208b6-43d9-44d3-a1cf-518e956aabd5"
priority: "high"
tags:
  - "tests"
  - "unit"
  - "refactor"
  - "deduplication"
source: "smart-add"
---

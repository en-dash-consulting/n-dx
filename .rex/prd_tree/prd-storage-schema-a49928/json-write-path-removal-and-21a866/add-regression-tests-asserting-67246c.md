---
id: "67246c10-3996-4481-86c9-6e753b0cb52a"
level: "task"
title: "Add regression tests asserting no JSON writes occur outside ndx start"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "testing"
  - "prd-storage"
source: "smart-add"
startedAt: "2026-04-29T03:39:51.660Z"
completedAt: "2026-04-29T13:08:47.420Z"
endedAt: "2026-04-29T13:08:47.420Z"
resolutionType: "code-change"
resolutionDetail: "Added cli-prd-no-json-writes.test.js with 7 tests across 3 suites (ndx add, rex update, rex prune) — each suite asserts prd.json is neither created nor modified. All pass."
acceptanceCriteria:
  - "Integration test runs ndx add with a new item description and asserts .rex/prd.json is not created or modified"
  - "Integration test runs rex edit on an existing item and asserts .rex/prd.json is not touched"
  - "Integration test runs rex prune and asserts .rex/prd.json is not touched"
  - "Tests are added to the existing e2e or integration suite and pass in CI without requiring ndx start"
description: "Add integration tests that run key PRD-mutating commands and assert that .rex/prd.json is never created or modified as a side effect. These tests guard against future regression where code accidentally reintroduces a JSON write path."
---

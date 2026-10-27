---
id: "67246c10-3996-4481-86c9-6e753b0cb52a"
type: "change"
title: "Add regression tests asserting no JSON writes occur outside ndx start"
slug: "add-regression-tests-asserting-no-json"
intent: "Add integration tests that run key PRD-mutating commands and assert that .rex/prd.json is never created or modified as a side effect. These tests guard against future regression where code accidentally reintroduces a JSON write path."
acceptanceCriteria:
  - "Integration test runs ndx add with a new item description and asserts .rex/prd.json is not created or modified"
  - "Integration test runs rex edit on an existing item and asserts .rex/prd.json is not touched"
  - "Integration test runs rex prune and asserts .rex/prd.json is not touched"
  - "Tests are added to the existing e2e or integration suite and pass in CI without requiring ndx start"
touches:
  - "21a86676-166a-4af7-bc57-39af1f47d2ba"
priority: "medium"
tags:
  - "rex"
  - "testing"
  - "prd-storage"
source: "smart-add"
---

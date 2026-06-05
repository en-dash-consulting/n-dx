---
id: "3151022c-f35e-4e0e-acbe-25b701ef2cf9"
level: "task"
title: "Add regression tests for Google API key validation across config and init paths"
status: "pending"
priority: "high"
tags:
  - "google"
  - "llm"
  - "testing"
  - "validation"
source: "smart-add"
acceptanceCriteria:
  - "Unit tests assert pass/fail for all four key format boundary cases (valid, too short, wrong prefix, empty)"
  - "At least one integration test exercises the ndx config set path with a valid-format key and asserts no validation error is thrown"
  - "Tests are placed alongside the existing Google provider validation tests (or config schema tests)"
  - "All new tests pass in CI without requiring a live Google API call"
description: "After the fix, add unit and integration tests that assert the validation boundary conditions for Google AI API keys. Cover: keys that start with AIza and meet the minimum length (should pass), keys that are too short (should fail), keys with the wrong prefix (should fail), and an empty string (should fail). Also add a lightweight integration test that exercises the ndx config set path with a stubbed valid key to prevent config-layer regressions from silently breaking the validation surface."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:7acad3da-6e29-4e52-bed1-121ad63b4fd3","matchedItemId":"7acad3da-6e29-4e52-bed1-121ad63b4fd3","matchedItemTitle":"Add regression tests for single-child compaction across write path and reshape migration","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-05T14:41:50.064Z"}
---

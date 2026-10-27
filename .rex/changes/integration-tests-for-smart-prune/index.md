---
id: "c79dec6c-2402-4a63-a9dd-aa81f4270f83"
type: "change"
title: "Integration tests for smart prune caching workflow"
slug: "integration-tests-for-smart-prune"
intent: "Add integration tests to verify the smart prune caching workflow end-to-end. Tests go in packages/rex/tests/integration/cli/commands/prune-cache.test.ts.\n\nThe smart prune caching feature (packages/rex/src/cli/commands/prune.ts lines 467-502) caches LLM-generated reshape proposals so that a dry-run followed by --accept reuses proposals without a second LLM call. The cache module is packages/rex/src/core/pending-cache.ts (hashPRD, savePendingSmartPrune, loadPendingSmartPrune, clearPendingSmartPrune).\n\nUnit tests exist in packages/rex/tests/unit/core/pending-cache.test.ts covering the cache module in isolation. These new integration tests must cover the actual smartPrune function's caching behavior."
acceptanceCriteria:
  - "Test: cache file (.rex/pending-smart-prune.json) is written after LLM generation with correct prdHash"
  - "Test: second smartPrune call with unchanged PRD uses cache (reasonForReshape not called again, 'Using cached proposals' message emitted)"
  - "Test: cache is invalidated when PRD changes between runs (hash mismatch triggers fresh LLM call)"
  - "Test: cache is cleared after successful apply (accept=true)"
  - "All tests mock the LLM layer (vi.mock on reasonForReshape from ../../core/reshape.js) — no real LLM calls"
  - "Tests use temp directory with valid .rex/prd.json setup per test case"
touches:
  - "ff24d31d-6bfc-4ed8-979e-2bc790ed8549"
priority: "high"
source: "manual"
---

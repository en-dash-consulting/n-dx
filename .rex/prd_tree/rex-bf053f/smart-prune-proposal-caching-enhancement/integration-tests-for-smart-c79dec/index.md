---
id: "c79dec6c-2402-4a63-a9dd-aa81f4270f83"
level: "task"
title: "Integration tests for smart prune caching workflow"
status: "completed"
priority: "high"
source: "manual"
startedAt: "2026-03-11T02:15:34.342Z"
completedAt: "2026-03-11T02:19:12.951Z"
resolutionType: "acknowledgment"
resolutionDetail: "Integration tests already exist at packages/rex/tests/integration/cli/commands/prune-cache.test.ts with all 4 acceptance criteria covered and passing."
acceptanceCriteria:
  - "Test: cache file (.rex/pending-smart-prune.json) is written after LLM generation with correct prdHash"
  - "Test: second smartPrune call with unchanged PRD uses cache (reasonForReshape not called again, 'Using cached proposals' message emitted)"
  - "Test: cache is invalidated when PRD changes between runs (hash mismatch triggers fresh LLM call)"
  - "Test: cache is cleared after successful apply (accept=true)"
  - "All tests mock the LLM layer (vi.mock on reasonForReshape from ../../core/reshape.js) — no real LLM calls"
  - "Tests use temp directory with valid .rex/prd.json setup per test case"
description: "Add integration tests to verify the smart prune caching workflow end-to-end. Tests go in packages/rex/tests/integration/cli/commands/prune-cache.test.ts.\n\nThe smart prune caching feature (packages/rex/src/cli/commands/prune.ts lines 467-502) caches LLM-generated reshape proposals so that a dry-run followed by --accept reuses proposals without a second LLM call. The cache module is packages/rex/src/core/pending-cache.ts (hashPRD, savePendingSmartPrune, loadPendingSmartPrune, clearPendingSmartPrune).\n\nUnit tests exist in packages/rex/tests/unit/core/pending-cache.test.ts covering the cache module in isolation. These new integration tests must cover the actual smartPrune function's caching behavior."
---

# Integration tests for smart prune caching workflow

🟠 [completed]

## Summary

Add integration tests to verify the smart prune caching workflow end-to-end. Tests go in packages/rex/tests/integration/cli/commands/prune-cache.test.ts.

The smart prune caching feature (packages/rex/src/cli/commands/prune.ts lines 467-502) caches LLM-generated reshape proposals so that a dry-run followed by --accept reuses proposals without a second LLM call. The cache module is packages/rex/src/core/pending-cache.ts (hashPRD, savePendingSmartPrune, loadPendingSmartPrune, clearPendingSmartPrune).

Unit tests exist in packages/rex/tests/unit/core/pending-cache.test.ts covering the cache module in isolation. These new integration tests must cover the actual smartPrune function's caching behavior.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-11T02:15:34.342Z
- **Completed:** 2026-03-11T02:19:12.951Z
- **Duration:** 3m

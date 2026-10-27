---
id: "3ac045d9-23d2-442e-8be6-28d13edea664"
type: "change"
title: "Integration tests for smart-add cache staleness detection"
slug: "integration-tests-for-smart-add-cache"
intent: "Add integration tests to verify the smart-add PRD hash validation and staleness detection. Tests go in packages/rex/tests/integration/cli/commands/smart-add-cache.test.ts.\n\nThe smart-add caching feature (packages/rex/src/cli/commands/smart-add.ts) saves a prdHash alongside cached proposals via savePending(). When --accept is used, replayCachedIfRequested() (line ~1129) loads cached proposals, computes current PRD hash, and compares. If hashes differ, it warns and clears stale cache.\n\nThe prdHash is passed through maybeCacheSmartAddProposals() at three call sites (lines ~1376, ~1496, ~1532) using hashPRD(existing) where existing is the current PRD items array.\n\nKey functions to test:\n- savePending (line 706): should include prdHash in JSON\n- loadPending (line 714): should return prdHash from JSON  \n- replayCachedIfRequested (line ~1127): staleness check logic\n- maybeCacheSmartAddProposals (line ~1303): hash passthrough"
acceptanceCriteria:
  - "Test: savePending writes prdHash to pending-proposals.json when provided"
  - "Test: loadPending returns prdHash from cached file"
  - "Test: --accept (replayCachedIfRequested) succeeds when PRD hash matches cached hash"
  - "Test: --accept rejects stale cache when PRD has changed (warns and clears cache, returns false)"
  - "Test: --accept works with backward-compatible cache files that have no prdHash field (proceeds without validation)"
  - "Test: maybeCacheSmartAddProposals passes hash through to savePending"
  - "All tests mock the LLM layer — no real LLM calls"
  - "Tests use temp directory with valid .rex/ setup per test case"
touches:
  - "6772d41b-37bf-44ea-9cf9-e7dc25c15c79"
priority: "high"
source: "manual"
---

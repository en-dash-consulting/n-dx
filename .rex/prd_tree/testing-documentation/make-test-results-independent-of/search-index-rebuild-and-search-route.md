---
id: "74d203ab-e6c5-49c4-a73f-3c9116257734"
level: "task"
title: "Search index rebuild and search route elapsed budgets bypass the documented BUDGET_MULTIPLIER policy"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "Registered in tests/wall-clock-assertion-inventory.md under Open. Two absolute elapsed budgets sit directly beside siblings that do scale, so the inconsistency is visible in the same test body. packages/web/tests/unit/server/search-index.test.ts:524 asserts expect(rebuildElapsed).toBeLessThan(5000) while line 531 uses 200 * BUDGET_MULTIPLIER. packages/web/tests/unit/server/routes-search.test.ts:250 asserts expect(data.elapsed_ms).toBeLessThan(200) on a server-measured duration returned over HTTP while line 252 uses 500 * BUDGET_MULTIPLIER. Note that scaling line 524 is NOT available: 5000 * 20 exceeds the web package's 30s testTimeout, so the assertion would become unfailable — TESTING.md forbids scaling a bound whose job is to sit below another number. The claim in both cases is 'rebuild/search is not super-linear', which wants a growth ratio over two index sizes measured in the same process (say 250 and 1000 items), with the bound derived from a clean run and an injected super-linear regression per TESTING.md rule 3. Update the inventory rows when done."
lastModified: "2026-09-09T20:56:17.535Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

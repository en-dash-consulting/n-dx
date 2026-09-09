---
id: "2098655c-94ac-489b-a012-c6db319d8767"
level: "task"
title: "prd-tree-atomic-writes asserts raw 500ms latency budgets and compares two adjacent micro-spans"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "Registered in tests/wall-clock-assertion-inventory.md under Open. Three assertions in packages/rex/tests/integration/prd-tree-atomic-writes.test.ts decide their verdict from a clock: line 317 expect(median).toBeLessThan(500) and line 340 expect(latency).toBeLessThan(500) are raw absolute constants with no BUDGET_MULTIPLIER, and line 369 expect(addTime).toBeLessThanOrEqual(reserializeTime) compares two independent micro-spans where the expected gap is small, so one scheduling hiccup inside the first span flips the result. Line 317 is already marked DEFERRED in place. Prefer TESTING.md Family 2 technique 1 for line 369: 'no full-tree re-serialization on single-item add' is a claim about write volume, so count the writes (spy the adapter's writeFile/rename) rather than timing them. For 317 and 340, either count syscalls the same way or assert growth between two PRD sizes measured in the same process, deriving the bound from a clean run and an injected regression per TESTING.md rule 3. Do not simply multiply by BUDGET_MULTIPLIER. Update the inventory row when done."
lastModified: "2026-09-09T20:56:06.569Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

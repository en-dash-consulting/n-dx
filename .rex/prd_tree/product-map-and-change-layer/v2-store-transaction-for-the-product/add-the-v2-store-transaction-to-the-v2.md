---
id: "d3c20225-50a4-4913-b0c6-62ec0c45b3b6"
level: "task"
title: "Add the v2 store transaction to the v2 isolation test's module set"
status: "pending"
priority: "high"
tags:
  - "pr-31"
  - "lane-rex-store"
  - "rex"
source: "run-verification"
acceptanceCriteria:
  - "The v2 isolation test in packages/rex/tests/unit/schema/v2.test.ts passes with store/prd-model-transaction.ts in its v2 module set (test)"
  - "The only file changed outside .rex/ is packages/rex/tests/unit/schema/v2.test.ts"
description: "Follow-up to 000328e7, run d3e891fe (commits 034fecbb0, 66426a641). That run added packages/rex/src/store/prd-model-transaction.ts, which imports prd-model-reader, prd-model-writer and schema/v2-rules. The isolation test in packages/rex/tests/unit/schema/v2.test.ts (\"no runtime module imports the v2 modules yet\") lists the v2 modules that may import each other, and the transaction is not in that list, so the test fails with offenders [\"store/prd-model-transaction.ts\"]. PR 31's boundary says the transaction joins the set of v2 modules.\n\nWork: add \"store/prd-model-transaction.ts\" to the v2Files set and name the store transaction in the comment above it. Change nothing else: no source change, no other test. Nothing outside the v2 set may import the transaction yet (PR 17 is its first runtime caller and will turn this test into an allowlist of wired callers).\n\nBefore finishing, run the rex unit tests for schema/v2 and store/prd-model-transaction, then pnpm --filter @n-dx/rex build. If a review repair edits any file under packages/rex/src, rebuild rex again: hench's test gate refuses a stale dist/."
lastModified: "2026-10-08T21:03:20.890Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

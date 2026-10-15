---
id: "b6564c07-4cae-4f11-903e-ada8957aa99c"
level: "task"
title: "hench task-lookup.ts imports @n-dx/rex directly, bypassing rex-gateway"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "v2-hardening"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "task-lookup.ts has no import of \"@n-dx/rex\", static or dynamic"
  - "A policy test fails on a dynamic import(\"@n-dx/rex\") in hench outside src/prd/rex-gateway.ts"
description: "Found by the adversarial review of bf377f39 (run 03cb3ce3). Verdict: out-of-scope. The defect predates that change.\n\npackages/hench/src/cli/commands/task-lookup.ts:14 and :45 use `await import(\"@n-dx/rex\")` for resolveStore and findItem. Every hench runtime import from rex is meant to go through packages/hench/src/prd/rex-gateway.ts. domain-isolation.test.js does not catch dynamic imports, so the bypass is invisible to the policy tests. Nothing fails today, but a rex API change would break these lookups outside the gateway's contract test.\n\nOption (recommended): import resolveStore and findItem from ../../prd/rex-gateway.js. Both are already re-exported, so the fix is about two lines and low risk. Optionally, extend domain-isolation to flag dynamic `import(\"@n-dx/rex\")` outside the gateway."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:38:56.606Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

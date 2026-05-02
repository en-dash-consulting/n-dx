---
id: "37c37dde-4887-48a0-97cc-6f99eaf0f386"
level: "task"
title: "Address pattern issues (2 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-08T18:10:02.994Z"
completedAt: "2026-03-08T18:16:56.486Z"
acceptanceCriteria: []
description: "- The data-layer contract (never imported at runtime) is convention-only. Consider adding a lint rule or CI check that asserts no `.ts`/`.js` source file contains an import path resolving into `.rex/` to make the contract machine-enforceable rather than doc-only.\n- The cleanup scheduler (usage-cleanup-scheduler.ts) is a stateful process-level concern but is absent from monorepo-integration-tests — if the scheduler interacts with rex or sourcevision stores at startup, that contract is currently untested at the integration boundary"
recommendationMeta: "[object Object]"
---

# Address pattern issues (2 findings)

🟠 [completed]

## Summary

- The data-layer contract (never imported at runtime) is convention-only. Consider adding a lint rule or CI check that asserts no `.ts`/`.js` source file contains an import path resolving into `.rex/` to make the contract machine-enforceable rather than doc-only.
- The cleanup scheduler (usage-cleanup-scheduler.ts) is a stateful process-level concern but is absent from monorepo-integration-tests — if the scheduler interacts with rex or sourcevision stores at startup, that contract is currently untested at the integration boundary

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-03-08T18:10:02.994Z
- **Completed:** 2026-03-08T18:16:56.486Z
- **Duration:** 6m

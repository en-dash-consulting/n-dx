---
id: "71575514-5f7c-4500-ae0c-49a21183c2d4"
level: "task"
title: "Fix code in global: Establish a satellite zone testing policy requiring every production file in a s (+3 more)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T00:46:29.439Z"
completedAt: "2026-04-14T01:01:17.902Z"
acceptanceCriteria: []
description: "- Establish a satellite zone testing policy requiring every production file in a satellite zone to have a corresponding unit test file, using task-usage-scheduler's 4:4 production-to-test parity as the benchmark. Currently both rex satellite zones fail this bar: rex-fix-pipeline leaves fix/tree.ts and fix/types.ts untested, while rex-recommend leaves similarity.ts (140 lines) and tree.ts untested. Without an explicit policy, satellite zones pass test-presence checks while leaving core implementation logic unexercised.\n- No integration test verifies the behavioral contract of either injection seam (register-scheduler.ts RegisterSchedulerOptions, polling-restart.ts PollingRestartOptions) — TypeScript enforces structural compatibility at compile time but cannot verify that injected implementations behave correctly at runtime; a seam-contract integration test per site would catch behavioral regressions when the implementing module changes without altering the interface signature.\n- The filesystem-level coupling between prd-epic-resolver.ts and core/ci.js (CLI flag conventions, exit code contracts, stderr parsing format) is unenforceable by any existing monorepo boundary tool. It is the only cross-tier contract in the codebase with zero type-system or test coverage at the boundary itself. A contract test in the e2e suite that asserts specific exit codes and output format from prd-epic-resolver.ts would make this invisible contract auditable.\n- boundary-check.test.ts enforces the web-shared addition policy and two-consumer rule but does not assert that all viewer→server imports are type-only. Given that viewer and server are separate build artifacts, a runtime import in this direction would be a silent build-time boundary violation. The current codebase has no violations, but the absence of an automated guard means the invariant is enforced only by convention. Adding a 'viewer files must not runtime-import from server/' assertion closes the last unchecked boundary in the web package."
recommendationMeta: "[object Object]"
---

# Fix code in global: Establish a satellite zone testing policy requiring every production file in a s (+3 more)

🟠 [completed]

## Summary

- Establish a satellite zone testing policy requiring every production file in a satellite zone to have a corresponding unit test file, using task-usage-scheduler's 4:4 production-to-test parity as the benchmark. Currently both rex satellite zones fail this bar: rex-fix-pipeline leaves fix/tree.ts and fix/types.ts untested, while rex-recommend leaves similarity.ts (140 lines) and tree.ts untested. Without an explicit policy, satellite zones pass test-presence checks while leaving core implementation logic unexercised.
- No integration test verifies the behavioral contract of either injection seam (register-scheduler.ts RegisterSchedulerOptions, polling-restart.ts PollingRestartOptions) — TypeScript enforces structural compatibility at compile time but cannot verify that injected implementations behave correctly at runtime; a seam-contract integration test per site would catch behavioral regressions when the implementing module changes without altering the interface signature.
- The filesystem-level coupling between prd-epic-resolver.ts and core/ci.js (CLI flag conventions, exit code contracts, stderr parsing format) is unenforceable by any existing monorepo boundary tool. It is the only cross-tier contract in the codebase with zero type-system or test coverage at the boundary itself. A contract test in the e2e suite that asserts specific exit codes and output format from prd-epic-resolver.ts would make this invisible contract auditable.
- boundary-check.test.ts enforces the web-shared addition policy and two-consumer rule but does not assert that all viewer→server imports are type-only. Given that viewer and server are separate build artifacts, a runtime import in this direction would be a silent build-time boundary violation. The current codebase has no violations, but the absence of an automated guard means the invariant is enforced only by convention. Adding a 'viewer files must not runtime-import from server/' assertion closes the last unchecked boundary in the web package.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** task
- **Started:** 2026-04-14T00:46:29.439Z
- **Completed:** 2026-04-14T01:01:17.902Z
- **Duration:** 14m

---
id: "e8d1026d-d347-4c69-a35a-1fb19e677444"
level: "task"
title: "merge-driver-git test fails misleadingly on a stale dist instead of saying to rebuild"
status: "pending"
priority: "medium"
tags:
  - "e2e-finding"
  - "test-infra"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "A stale dist makes the test fail with a message naming the build as the cause, not NDX_CLI_NOT_INITIALIZED"
  - "The guard checks dist freshness against src rather than mere existence, or builds dist as part of setup"
  - "Other tests that spawn from dist/ are audited for the same existence-only guard"
  - "The rex CLI's not-initialized error is considered for a merge-driver-specific hint when the path looks like a git merge temp file"
description: "packages/rex/tests/integration/merge-driver-git.test.ts spawns the built CLI from dist/ because git launches the merge driver as a separate process. Its beforeEach guards this with an `access(CLI_DIST)` check whose error message says \"Built CLI not found at ... — run 'pnpm build' before this test\", so the intent to catch a build problem is already there.\n\nBut the guard only checks that dist exists, not that it is current. With a stale dist both tests fail with something else entirely: `[NDX_CLI_NOT_INITIALIZED] Rex directory not found in <tmp>/rex-merge-driver-XXX/.merge_file_XXX`, plus a downstream assertion failure because the driver never wrote conflict markers. Nothing in that output points at the build.\n\nObserved today: a full `pnpm run validate` failed with those two tests red. The source was already correct — cli/index.ts:322 exempts \"merge-driver\" from the SKIP_DIR_CHECK dir resolution, with a comment describing exactly this scenario — but dist predated that fix. `pnpm --filter @n-dx/rex run build` made both pass with no source change. Diagnosing it cost a full validation cycle.\n\nOptions: compare dist and src mtimes in the guard and fail with the rebuild instruction; have the test build dist itself; or make the rex CLI's error message name the merge-driver case when it sees a .merge_file_ path. The last is independently useful since a real user hitting a stale global install gets the same opaque error."
lastModified: "2026-08-27T16:51:00.607Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

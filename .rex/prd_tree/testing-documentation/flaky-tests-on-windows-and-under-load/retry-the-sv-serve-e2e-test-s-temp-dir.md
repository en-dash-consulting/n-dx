---
id: "1ffb493c-a1c0-4d11-8871-a4f4284dbc54"
level: "task"
title: "Retry the sv serve e2e test's temp-dir removal on Windows"
status: "pending"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #815"
  - "afterEach's rm in packages/sourcevision/tests/e2e/cli-serve.test.ts retries (maxRetries: 10, retryDelay: 100) with a comment naming the Windows handle-release cause"
  - "No product file under packages/sourcevision/src changes"
  - "The file passes locally: npx vitest run --root packages/sourcevision tests/e2e/cli-serve.test.ts"
description: "GitHub #815. packages/sourcevision/tests/e2e/cli-serve.test.ts › \"serves viewer and data files\" fails intermittently on Tests (Windows, rex+sourcevision) in afterEach, with the test's checks passing: `EBUSY: resource busy or locked, rmdir '...\\sv-serve-...'` (seen on #812, run 38952064138 attempt 1). afterEach kills the sv serve child (killTree, then SIGKILL after 3 s) and then calls `rm(tmpDir, { recursive: true, force: true })` (around line 98). Windows releases the killed server's handles slightly after close fires. killTree's `process.kill(-pid)` has no process-group meaning on Windows, so it always falls through to killing the pid alone.\n\nFix: give that rm `maxRetries: 10, retryDelay: 100`, matching cli-analyze.test.ts's afterEach in the same package, with a one-line comment. Do not change sv serve.\n\nTest-only: change the test file(s) named here and nothing in product code. If the flake turns out to be a real product bug, stop and record that instead of fixing the product. These flakes do not reproduce on macOS, so the fix must be correct from the failure as recorded; where cheap, force the condition locally to show the old test fails and the new one passes."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:28:46.988Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

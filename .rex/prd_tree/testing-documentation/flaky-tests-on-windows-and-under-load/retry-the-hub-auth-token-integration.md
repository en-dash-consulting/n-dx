---
id: "5743318a-93eb-4ac6-b5ba-12ec5886d117"
level: "task"
title: "Retry the hub-auth-token integration test's temp-dir removal on Windows"
status: "completed"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
startedAt: "2026-10-17T01:16:15.415Z"
completedAt: "2026-10-17T01:19:24.371Z"
endedAt: "2026-10-17T01:19:24.371Z"
acceptanceCriteria:
  - "Closes #784"
  - "afterAll's temp-dir removal in packages/web/tests/integration/hub-auth-token.test.ts retries (maxRetries: 10, retryDelay: 100) with a comment naming the Windows handle-release cause"
  - "No product file under packages/web/src changes"
  - "The file passes locally: npx vitest run --root packages/web tests/integration/hub-auth-token.test.ts"
description: "GitHub #784. packages/web/tests/integration/hub-auth-token.test.ts fails intermittently on Tests (Windows, hench+web) in afterAll, with every test passing: `EBUSY: resource busy or locked, rmdir '...\\ndx-hub-auth-repo-...'`. afterAll awaits `hub.close({ stopChildren: true })` and then removes the home and repo temp dirs with `rmSync(dir, { recursive: true, force: true })` (around lines 58–60). On Windows a stopped child's handles on the repo dir are not always released by the time close resolves.\n\nFix: give that rmSync `maxRetries: 10, retryDelay: 100`, as tests/e2e/cli-child-cleanup.test.js, cli-orphan-cleanup.test.js and codex-mcp-contract.test.js already do, with a one-line comment saying why. fs.rm retries only EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE, so a genuine failure still surfaces. Do not change the hub.\n\nTest-only: change the test file(s) named here and nothing in product code. If the flake turns out to be a real product bug, stop and record that instead of fixing the product. These flakes do not reproduce on macOS, so the fix must be correct from the failure as recorded; where cheap, force the condition locally to show the old test fails and the new one passes."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T01:19:25.962Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

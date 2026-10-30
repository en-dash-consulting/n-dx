---
id: "cd7b335d-310a-4700-86a8-0b064b689618"
type: "task"
title: "Retry the temp-dir removal in four more Windows EBUSY teardowns"
slug: "retry-the-temp-dir-removal-in-four"
description: "GitHub #875. Four test files fail intermittently on Windows CI in teardown, with every assertion passing: `EBUSY: resource busy or locked, rmdir '...\\<prefix>-XXXXXX'`. Each test spawns a child whose working directory is the temp dir, and Windows has not always released the exited child's handles on it when teardown runs. Found by scanning every failed ci.yml test job from 2026-10-16 to 2026-10-27; see the issue for run ids.\n\n- packages/web/tests/unit/server/routes-run-commands.test.ts: afterEach `rm(tmpDir, { recursive: true, force: true })` (line 46). Three sightings, one on main.\n- tests/e2e/cli-init-git-preflight.test.js: afterEach `rm(tmpDir, …)` and `rm(binDir, …)` (lines 79–80).\n- packages/rex/tests/unit/core/verify.test.ts: the \"verify --run-tests and hostile test paths\" afterEach, `rmSync(tmp, { recursive: true, force: true })` (line 414). The other two bare rmSync calls in this file (lines 214 and 311) are in describes that spawn nothing; leave them unless a test there spawns a child.\n- tests/e2e/cli-migrate-layout.test.js: afterEach `rm(dir, { recursive: true, force: true })` (line 45).\n\nFix: give each of those removals `maxRetries: 10, retryDelay: 100` with a one-line comment naming the Windows handle-release cause, as tests/e2e/cli-child-cleanup.test.js, cli-orphan-cleanup.test.js, codex-mcp-contract.test.js and packages/sourcevision/tests/e2e/cli-analyze.test.ts already do. fs.rm/rmSync retry only EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE, so a genuine failure still surfaces. Do not change the route, ndx init, rex verify or migrate-layout.\n\nTest-only: change the test files named here and nothing in product code. If the flake turns out to be a real product bug (for example a child that outlives its parent and keeps the directory open), stop and record that instead of fixing the product. These flakes do not reproduce on macOS, so the fix must be correct from the failure as recorded."
acceptanceCriteria:
  - "Closes #875"
  - "The teardown removals named in the description (routes-run-commands.test.ts line 46, cli-init-git-preflight.test.js lines 79–80, verify.test.ts line 414, cli-migrate-layout.test.js line 45) retry with maxRetries: 10, retryDelay: 100 and a comment naming the Windows handle-release cause"
  - "No product file changes"
  - "Each of the four files passes locally"
priority: "high"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
---

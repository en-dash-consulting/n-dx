---
id: "ec80af41-ebba-4ecc-9427-a73e5b5bb186"
level: "task"
title: "routes-hench-prep test compares an 8.3 short temp path with the realpath, failing CLI Smoke (Windows) on PR #503"
status: "completed"
priority: "high"
tags:
  - "0.9.0"
  - "task-prep"
  - "web-server"
  - "windows"
  - "ci"
  - "tests"
source: "ci"
startedAt: "2026-10-05T18:56:19.852Z"
completedAt: "2026-10-05T19:07:54.611Z"
endedAt: "2026-10-05T19:07:54.611Z"
acceptanceCriteria:
  - "routes-hench-prep.test.ts compares realpath-resolved temp directories with the paths the route reports, so it passes when os.tmpdir() is an 8.3 short path."
  - "No other test added by this feature compares an unresolved temp path with a server-reported (realpath) path."
description: "PR #503's CLI Smoke (Windows) fails in \"Run per-package tests\" (run 37351234137, job 111902300677) with one web failure: packages/web/tests/unit/server/routes-hench-prep.test.ts:202 \"hench prep routes > GET /api/hench/prep/:taskId > answers for the addressed worktree: its directory, its branch, not the anchor\". It expects `workspace.root` to equal `tmpDir`, made with mkdtemp under os.tmpdir(); on the Windows runner that is the 8.3 short path `C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\hench-prep-…`, while the route reports the realpath-resolved long path `C:\\Users\\runneradmin\\AppData\\Local\\Temp\\hench-prep-…` (worktree roots are realpath-canonicalised on purpose). The route is right; the test is not.\n\nFix: compare against `realpathSync.native(tmpDir)` (or create tmpDir as `realpathSync.native(mkdtempSync(...))` up front) everywhere this file compares a temp path with a path the server reports — including the feature worktree case after line 204. Then grep this feature's other new tests (packages/web/tests/unit/server/routes-hench-*.test.ts, routes-hench-prep*.test.ts, tests/integration/workspace-slot-dispatch.test.ts, packages/hench/tests/integration/run-resolve.test.ts) for the same temp-path-vs-reported-path comparison and fix any you find. Test-only change: no changeset needed. The previous Windows fix in run-resolve.test.ts (normalising git's forward slashes) is the sibling of this one.\n\n## How to run checks without approval prompts (operator note)\n\nCommands are only pre-approved when they START with `npx`, `node`, `npm`, `git` or `vitest`; never prefix one with `cd … &&`. From the project root: `npx vitest run --root packages/web tests/unit/server/routes-hench-prep.test.ts`, the whole web suite with `npx vitest run --root packages/web`, and `npx tsc -p packages/web/tsconfig.test.json --noEmit`."
lastModified: "2026-10-05T19:07:56.915Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

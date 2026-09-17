---
id: "82a15be0-be2f-43a7-9b85-8e330e6ea9ee"
level: "task"
title: "Make same-worktree claim assertion portable on Windows"
status: "in_progress"
priority: "high"
tags:
  - "pr-06"
  - "claims"
  - "web"
  - "windows"
  - "ci"
source: "ndx-capture"
startedAt: "2026-09-17T03:16:29.500Z"
acceptanceCriteria:
  - "The same-worktree live-claim response test compares a platform-safe path component rather than a Windows path spelling."
  - "The test continues to prove that a live claim held by another PID in the same worktree returns 409 and includes claim-holder metadata."
  - "The focused web claim-route test passes on Windows and the CLI Smoke (Windows) job is green."
description: "Severity: high; release-blocking CI failure. PR #371 CLI Smoke (Windows), run 35171314893 / job 105045433884, fails only at `packages/web/tests/unit/server/routes-hench-execute-claims.test.ts:102`. The test calls `tmpDir.split(\"/\").at(-1)` to derive an expected temp path. On Windows this remains the entire 8.3 path (`C:\\Users\\RUNNER~1\\...`), whereas the response returns its canonical long-path equivalent (`C:\\Users\\runneradmin\\...`). Use a platform-safe leaf comparison such as `basename(tmpDir)` and preserve the response semantics coverage."
lastModified: "2026-09-17T03:16:29.833Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

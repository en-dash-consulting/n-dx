---
id: "b19513b5-1573-4ba3-a5ad-b8c4a19e6616"
level: "task"
title: "Scale the worktrees-route watcher wait with BUDGET_MULTIPLIER"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "test-determinism"
  - "pr-t"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "The waitFor timeout in worktrees-route.test.ts is derived from BUDGET_MULTIPLIER."
  - "The file passes three consecutive preflight runs on a loaded machine, documented in the PR."
  - "tests/unit/vitest-timeout-policy.test.js still passes."
description: "packages/web/tests/integration/worktrees-route.test.ts:317 ('a run file saved in another worktree pushes hench:run-changed without the Runs view', added in #393) waits a fixed 4s for a file-watcher event. Under full-suite preflight load on macOS it failed once (2026-09-23) and passed 5/5 in isolation. Derive the wait from BUDGET_MULTIPLIER like the other load-sensitive tests. Test-only change, no changeset."
lastModified: "2026-09-23T23:41:00.942Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

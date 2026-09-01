---
id: "e5402817-c4fd-4bbc-b44e-6c979bed6199"
level: "feature"
title: "Unify cross-OS process-tree termination behind one contract"
status: "completed"
priority: "high"
tags:
  - "windows"
  - "process-lifecycle"
  - "reliability"
  - "core"
  - "testing"
source: "exploration-2026-08-17"
startedAt: "2026-08-17T19:29:05.945Z"
completedAt: "2026-08-17T19:37:00.220Z"
endedAt: "2026-08-17T19:37:00.220Z"
acceptanceCriteria:
  - "Callers of child-lifecycle.js never branch on process.platform for termination — one `terminateTree` contract covers both OSes"
  - "PLATFORM_SUPPORTS_PROCESS_GROUPS is no longer part of the module's public surface"
  - "A grandchild spawned by an ndx child process is reaped on Windows, proven by a CI-green assertion rather than inspection"
  - "The chosen Windows strategy (taskkill vs Job Objects) is documented with its grace-period tradeoff stated explicitly"
  - "NDX_DEBUG_LIFECYCLE traces which termination strategy ran"
description: "packages/core/child-lifecycle.js branches on `process.platform` in two places — `PLATFORM_SUPPORTS_PROCESS_GROUPS` (child-lifecycle.js) and `SPAWN_DETACHED` (cli.js) — and Windows silently gets *direct child kill only*. Grandchildren leak. Because `ndx` spawns CLIs that themselves spawn processes (claude/codex), that leak is real on Windows, not theoretical.\n\nThe OS primitives genuinely differ, so \"standardize\" must mean standardizing observable BEHAVIOR, not just the code path:\n\n| | macOS/POSIX | Windows |\n|---|---|---|\n| Kill a tree | `process.kill(-pgid, SIG)` with `detached: true` | no equivalent — `detached` means \"new console\" |\n| Signals | real SIGTERM/SIGKILL | emulated; SIGTERM ~ TerminateProcess, no graceful phase |\n\nWindows tree-kill options: `taskkill /PID <pid> /T /F` — `/T` kills the whole tree, ships with Windows, no dependency, but force-only so there is no SIGTERM grace period; or Job Objects, the correct Windows primitive with kill-on-close semantics exactly analogous to process groups, but requiring a native addon.\n\nTarget shape: a single `terminateTree(child, timeoutMs)` exported from child-lifecycle.js that internally dispatches to `kill(-pgid)` on POSIX and `taskkill /T /F` on Windows, with ONE exported contract and no `PLATFORM_SUPPORTS_PROCESS_GROUPS` leaking to callers. Callers then never branch — that is the real standardization win. The NDX_DEBUG_LIFECYCLE flag (already added) becomes the place to trace which strategy ran.\n\nVERIFICATION GAP drives the ordering: the e2e tests that would prove any of this (tests/e2e/cli-orphan-cleanup.test.js, tests/e2e/cli-ci-child-cleanup.test.js) are skipped on Windows — all 3 cases. Windows tree-cleanup is currently unverified by CI. Un-skipping them with a Windows grandchild assertion matters MORE than the implementation; otherwise this replaces a known-incomplete behavior with an unverified one."
---

## Children

| Title | Status |
|-------|--------|
| [Fix POSIX group-kill escalation gated on the direct child instead of the group](./fix-posix-group-kill-escalation-gated.md) | completed |
| [Implement single terminateTree contract dispatching kill(-pgid) / taskkill /T /F](./implement-single-terminatetree.md) | completed |
| [Un-skip the 6 Windows process-cleanup e2e cases with grandchild assertions (TDD red step)](./un-skip-the-6-windows-process-cleanup.md) | completed |

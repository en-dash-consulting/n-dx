---
id: "3ef3366c-7d84-4f33-a0e0-3f9c3f368e61"
level: "task"
title: "ndx start resolves the repo via the git common dir, derives the project id, starts the hub if absent, registers and opens /p/:id/"
status: "pending"
priority: "high"
tags:
  - "pr-10"
  - "core"
blockedBy:
  - "e879c6ba-bcfe-4c76-821c-5972112bc49d"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Integration test with a temp repo + linked worktree: `ndx start <worktree>` registers repoRoot = main worktree and lists the worktree; second call from another temp repo registers a second project; both URLs answer."
  - "`--here` path is byte-for-byte the 0.6.0 behaviour (existing tests unchanged)."
description: "In packages/core/web.js: (1) repoRoot = realpath of the main worktree (first entry of `git worktree list --porcelain`, or --show-toplevel when not a linked worktree), thisWorktree = realpath(absDir), branch; (2) id = slug of .rex/config.json \"project\" (fallback: repo directory basename), with a 6-char hash of the origin remote URL appended only when the registry already holds the same id for a different repoRoot; (3) hub alive check: ~/.n-dx/hub.pid + GET http://127.0.0.1:<hubPort>/api/hub/health (hubPort from ~/.n-dx/config.json, default 3117); if absent spawn the hub detached (same CLAUDECODE-stripping pattern as today's background mode) and wait for health; (4) POST /api/hub/projects { id, repoRoot, worktree, ndxBin: this cli.js path }; (5) print the URL and MCP endpoints and open the browser when --open. --here → existing code path untouched. Windows: keep the existing win-spawn helpers."
lastModified: "2026-09-10T20:12:17.110Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

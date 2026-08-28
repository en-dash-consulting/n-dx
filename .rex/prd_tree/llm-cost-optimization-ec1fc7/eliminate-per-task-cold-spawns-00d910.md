---
id: "00d910d1-dc49-488d-bd6f-3d26911abc79"
level: "feature"
title: "Eliminate per-task cold spawns (warm-parent fork + session batching)"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "sessions"
  - "caching"
  - "cold-start"
source: "ndx-capture"
acceptanceCriteria:
  - "ndx work --loop with the fork strategy runs one orientation session and forks it per task via --resume <parentId> --fork-session; forked tasks show no repo re-exploration turns"
  - "The parent session id and its invalidation keys (sourcevision content hash, createdAt) are persisted in .hench/session-cache.json"
  - "The parent is invalidated and rebuilt when the sourcevision content hash changes, when older than hench.parentMaxAgeHours (default 24), or when ndx work --fresh is passed"
  - "hench.sessionStrategy accepts fork, batch, and cold; default is fork for the claude CLI provider and cold otherwise"
  - "The batch strategy executes hench.tasksPerSession tasks (default 4) in one CLI session with explicit task-boundary dividers, starting a fresh session on failure or context exhaustion"
  - "codex and local providers fall back to a non-fork strategy without error"
  - "The orientation prompt forbids modifications; the orientation session makes no writes"
description: "Every hench task today is a fresh claude -p spawn — re-paying the harness prompt, CLAUDE.md, skill metadata, and repo re-exploration per task, even inside --loop/--iterations (audit H1; estimated 40–60% of spend). Implement the design's §08 session architecture: (a) warm-parent fork — one orientation-only session per loop/repo-state (target 20–50K transcript tokens), cached in .hench/session-cache.json, with each task spawned via claude -p --resume <parentId> --fork-session so forks inherit orientation with a byte-identical prefix (cache-read pricing within the TTL); (b) sequential batching — hench.tasksPerSession feeds task N+1's brief as the next user turn; (c) hench.sessionStrategy config selecting fork | batch | cold. Parent invalidation: sourcevision content-hash change, hench.parentMaxAgeHours (default 24), or ndx work --fresh."
lastModified: "2026-08-28T17:38:58.341Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

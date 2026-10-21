---
id: "fae4e9ca-fa04-4359-a482-8f703143ea47"
level: "task"
title: "A worktree workspace's first PRD read answers 404 until its lazily written cache lands"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The first GET /api/rex/prd routed to a not-yet-created worktree workspace answers 200 with that worktree's PRD, with no .rex/.cache/prd.json in the worktree beforehand"
  - "A web integration test drives that first request through the workspace dispatcher and fails on the current fire-and-forget setup"
description: "Verdict: out-of-scope (pre-existing). Found while reviewing 9395aab1, which moved the anchor's boot cache write ahead of `listen` (commit cc52920fb). The anchor no longer races; non-anchor workspaces still do.\n\nScenario: with `ndx start` running, the first request routed to another worktree of the repository (WorkspaceRegistry creates its workspace lazily) runs `createWorkspaceHooks().setup` in packages/web/src/server/start.ts. `setup` is synchronous and calls `void refreshPRDCache(ctx.rexDir)` without waiting for it, so the same request (e.g. GET /api/rex/prd for that worktree) reaches `loadPRDSync` before `.rex/.cache/prd.json` exists. A folder tree has no prd.md or prd.json to fall back to, so the request answers 404 \"No PRD data found\". On a large tree this lasts about a second.\n\nReachable: the dashboard's worktree switcher, or any `/p/<id>/` request that names a worktree workspace.\n\nOptions:\n1. Make WorkspaceHooks.setup async, or return a ready promise that the dispatcher awaits before it serves the workspace's first request. Cost: a seam signature change (record it in the src/server/AGENTS.md seam registry) plus the registry's dispatch path. Recommended.\n2. Give loadPRDSync a sync folder-tree reader for when the cache is absent. Cost: rex has no sync parser, so this needs a new rex export through the gateway and a second parse path to keep in step with parseFolderTree and the v2 projection. Not recommended."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T04:02:17.484Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

---
id: "d95cab0e-ab9e-4d61-a1c5-f76b0efbfe2e"
level: "task"
title: "Dashboard writes go to the selected workspace's tree; editing the anchor while viewing a branch requires an explicit switch"
status: "pending"
priority: "high"
tags:
  - "pr-13"
  - "web"
blockedBy:
  - "fe40eba6-bc8e-4d12-9b5f-f91389f3a0ca"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Integration test: editing a task via /w/<wt>/api/rex/items writes <wt>/.rex/prd_tree and leaves the anchor's tree unchanged."
  - "Context strip renders only for non-anchor workspaces; docs updated."
description: "All PRD-writing routes (routes-rex/items.ts, prune.ts, health.ts, refinements.ts, requirements.ts, routes-rex-analysis.ts, routes-sourcevision-ask.ts apply-refinements) already resolve the store from ctx.rexDir; with request-scoped contexts (PR 11/12) they write to the selected workspace automatically. This task makes that explicit and safe: the PRD view shows a one-line context strip \"Workspace <name> · writes go to this worktree's PRD\" when the workspace is not the anchor; there is no cross-workspace write action; document the rule in packages/web/CLAUDE.md's concurrency section and in the root CLAUDE.md concurrency contract (a per-workspace PRD lock, one per rexDir)."
lastModified: "2026-09-10T20:12:32.907Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

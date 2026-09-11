---
id: "8d5f3393-57cf-4d83-8324-108cc4388d24"
level: "task"
title: "PRD delta versus the anchor computed server-side and exposed at /api/workspaces/:wt/prd-delta"
status: "pending"
priority: "high"
tags:
  - "pr-13"
  - "web"
blockedBy:
  - "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Unit tests with fixture documents for each category and for identical trees."
  - "Response for this repo's trusting-wiles worktree reports the same counts as `comm` on the id sets (35 only here, 109 only on main at time of writing)."
description: "packages/web/src/server/routes-workspaces.ts: load the anchor's and the workspace's PRDDocument (prd-io loadPRDSync per rexDir), diff by id: onlyHere (ids absent from anchor), onlyAnchor, changed (same id, different status/title/priority/description/lastModified), completedHere (completed in workspace, not completed in anchor); return counts plus id lists capped at 500 with a truncated flag. Cache per workspace pair, invalidated by either tree's watcher. Reuse the merge-graph's document loading if it fits; do not import rex beyond the existing web rex-gateway."
lastModified: "2026-09-10T20:12:30.061Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

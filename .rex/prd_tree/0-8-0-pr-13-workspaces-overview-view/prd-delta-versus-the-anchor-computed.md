---
id: "8d5f3393-57cf-4d83-8324-108cc4388d24"
level: "task"
title: "PRD delta versus the anchor computed server-side and exposed at /api/workspaces/:wt/prd-delta"
status: "completed"
priority: "high"
tags:
  - "pr-13"
  - "web"
blockedBy:
  - "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T19:15:30.203Z"
completedAt: "2026-09-16T19:20:15.313Z"
endedAt: "2026-09-16T19:20:15.313Z"
resolutionType: "code-change"
resolutionDetail: "packages/web/src/server/prd-delta.ts + GET /api/workspaces/:key/prd-delta: id-based diff (onlyHere/onlyAnchor/changed/completedHere), counts + capped id lists, cached per pair and invalidated by either tree's rex watcher."
acceptanceCriteria:
  - "Unit tests with fixture documents for each category and for identical trees."
  - "Response for this repo's trusting-wiles worktree reports the same counts as `comm` on the id sets (35 only here, 109 only on main at time of writing)."
description: "packages/web/src/server/routes-workspaces.ts: load the anchor's and the workspace's PRDDocument (prd-io loadPRDSync per rexDir), diff by id: onlyHere (ids absent from anchor), onlyAnchor, changed (same id, different status/title/priority/description/lastModified), completedHere (completed in workspace, not completed in anchor); return counts plus id lists capped at 500 with a truncated flag. Cache per workspace pair, invalidated by either tree's watcher. Reuse the merge-graph's document loading if it fits; do not import rex beyond the existing web rex-gateway."
lastModified: "2026-09-16T19:20:15.689Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

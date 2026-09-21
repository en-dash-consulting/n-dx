---
id: "89579226-600d-4657-976a-e3377e3cce7a"
level: "task"
title: "Stamp lastModified on tree mutations made inside store.withTransaction"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "reliability"
  - "sync"
startedAt: "2026-09-08T19:21:00.378Z"
completedAt: "2026-09-08T19:36:58.816Z"
endedAt: "2026-09-08T19:36:58.816Z"
acceptanceCriteria:
  - "A tree mutation performed inside store.withTransaction advances lastModified and sets lastModifiedBy, for FileStore and FolderTreeStore alike"
  - "The dashboard's bulk item update, merge route, and apply-refinements all stamp, without each route implementing its own stamp"
  - "Tests assert that an applied refinement, a bulk update, and a merge each leave the item looking modified (lastModified > lastSyncedAt), not only that the mutation landed"
  - "resolveActor's git shell-out does not run inside the PRD lock span"
description: "Routes that mutate the PRD tree directly inside store.withTransaction never stamp lastModified/lastModifiedBy, because only the single-item store methods (addItem/updateItem/removeItem) call stampModifiedFields. withTransaction itself validates and writes but does not stamp (packages/rex/src/store/file-adapter.ts:509-524). Three write paths are affected: the dashboard's bulk item update (packages/web/src/server/routes-rex/items.ts:398), its merge route (items.ts:490), and the Ask panel's apply-refinements (packages/web/src/server/prd-refinement.ts, applyRefinements). The consequence is in packages/rex/src/core/sync.ts and it is silent in both directions: isModifiedSinceSync returns false while lastModified <= lastSyncedAt, so a change to a previously-synced item never pushes to the remote; resolveConflicts then does last-write-wins on localTime vs remoteTime, and with localTime stale the next sync_with_remote overwrites the local change with the remote value. Reachable on any project configured with a remote adapter (Notion, Jira, GitHub Projects, Asana). Fix at the store tier rather than per route, so all three call sites are covered by one change: stamp where the tree is mutated, or stamp in withTransaction against a pre-mutation snapshot. Note that stampModifiedFields is async and resolveActor may shell out to git, so a per-route fix would want the stamp resolved once before the lock is opened - the same reasoning analyze.ts gives for stamping outside its transaction. Found by adversarial review of the apply-refinements feature branch; the finding originally read as specific to that route, but it predates it on main."
lastModified: "2026-09-08T19:36:58.832Z"
lastModifiedBy: "Hal Halberstadt <sterling.h@endash.us>"
---

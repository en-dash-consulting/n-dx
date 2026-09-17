---
"@n-dx/web": patch
---

Hench Runs view aggregates runs across worktrees. `GET /api/hench/runs` (and `/runs/:id`) accept `?scope=repo`, merging every worktree's `.hench/runs/` and tagging each run with `{ name, path, branch }`; the default scope is unchanged. A lazily registered `fs.watch` per other-worktree runs directory keeps `hench:run-changed` firing for runs written elsewhere. The viewer requests repo scope, shows a mono worktree chip on each card when runs span more than one worktree, and adds a worktree filter.

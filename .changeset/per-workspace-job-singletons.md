---
"@n-dx/web": minor
---

Per-workspace job state. The trackers that were process-wide singletons are now keyed by the workspace a request addresses (`src/server/workspace-scoped.ts`): the sv-analyze, refresh, self-heal, init, ci and reshape statuses and the `.sourcevision` writer lock in routes-commands; the epic-by-epic execution state and its hench process in routes-rex/execution; the active executions, execution metrics and process-memory tracker in routes-hench; and the status, project-metadata and config caches. Starting an analysis in worktree A no longer blocks or reports in worktree B; shutdown, emergency stop without a context, and the memory monitor sweep every workspace. A single-workspace server behaves exactly as before.

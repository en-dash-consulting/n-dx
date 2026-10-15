---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

v2 completion and selection hold up.

- A v2 change can no longer get stuck after being applied while in progress. `rex change apply` and MCP `apply_change` now refuse a change whose live tasks or nested changes are not all completed, naming them, and write nothing. Completing a change that was already applied (`rex update --status=completed`, `update_task_status`) closes it with `completedAt` and does not apply its amendments again.
- `ndx work --task=<change>` on a v2 tree no longer runs a change that still has open tasks. It runs and claims the change's next actionable task, skipping tasks another worktree has claimed, and never claims the change itself; `--resolve` reports that task. If every open task is claimed elsewhere, blocked or not actionable, the run is refused and names each task with the reason. A change with no tasks still runs as one unit. rex: `resolveWorkById` resolves such a change to its next runnable task (new `excludeIds` option), and `openChangeTasks` lists a change's open tasks.
- A kept v2 completion's run error no longer puts files that were already dirty before the run into its `git add` / `git commit` commands. It lists them apart, as dirty before the run and not part of the task.
- hench's `task-lookup.ts` imports rex through `src/prd/rex-gateway.ts`, and the domain-isolation policy now also fails on a dynamic `import("@n-dx/rex")` in hench outside the gateway.

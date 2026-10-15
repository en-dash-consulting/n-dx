---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

`ndx work --task=<change>` on a v2 tree no longer runs a change that still has open tasks. It now runs and claims the change's next actionable task, skipping tasks another worktree has claimed, and never claims the change itself; `--resolve` reports that task. If every open task is claimed elsewhere, blocked or not actionable, the run is refused and names each task with the reason. A change with no tasks still runs as one unit. Before this fix, the run worked the whole change and then could not complete it. rex: `resolveWorkById` resolves such a change to its next runnable task (new `excludeIds` option), and `openChangeTasks` lists a change's open tasks.

---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Task selection is claim-aware across worktrees. `hench run` (what `ndx work` spawns) claims the task it selects — before the brief and any LLM turn — and releases it when the run ends (completed, failed, cancelled by Ctrl-C, or thrown); an explicit `--task` another worktree holds is refused with the holder's worktree, and a retry in the worktree that already holds a task takes the claim over. `rex next`, the `get_next_task` MCP tool and hench's autoselection pass over tasks other worktrees hold (`skippedClaimed` in JSON output, one line per task under `--verbose`), and `findNextTask` / `findActionableTasks` accept `excludeIds`. The dashboard's execute route answers 409 with `claimedBy` when another worktree holds the task. Outside a git repository nothing changes.

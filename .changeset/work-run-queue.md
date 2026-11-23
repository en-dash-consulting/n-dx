---
"@n-dx/web": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

`ndx work` now runs tasks from a planned run queue first, lined up from the dashboard's Run queue panel on Work › Now and Plan › Preparation.

Add a ready task from the panel or from a Ready to run card's menu, reorder, or remove it. Plain autoselection (no `--task`, `--epic`, `--tags` or `--mine`) takes the queue's first item that can run before rex's own pick and takes it off; a finished, blocked or deleted item is dropped with a note, and one another worktree holds waits. The queue is saved as `run-queue.json` in the hench directory; add `.hench/run-queue.json` to your `.gitignore`, as the `ndx init` template now does. Ready to run moved from Work › Now to the top of Work › Tune.

---
"@n-dx/web": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

`ndx work` now runs tasks from a planned run queue first, lined up from the dashboard's Run queue panel on Work › Now and Plan › Preparation.

Add a ready task from the panel or from a Ready to run card's menu, reorder, or remove it. Plain autoselection (no `--task`, `--epic`, `--tags` or `--mine`) takes the queue's first item that can run before rex's own pick and takes it off; a finished or deleted item is dropped with a note, and one that is blocked, still in the Inbox or held by another worktree waits. A save from a window whose queue is out of date is refused and shows the queue as it stands. The queue is saved as `run-queue.json` in the hench directory; add `.hench/run-queue.json` to your `.gitignore`, as the `ndx init` template now does. Ready to run moved from Work › Now to the top of Work › Tune.

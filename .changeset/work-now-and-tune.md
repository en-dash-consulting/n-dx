---
"@n-dx/web": patch
---

The dashboard's Work page now opens on Now: what is running, who it is for, what is up next and what each run typically takes. Tune is Work's second mode.

Running now lists every live task run with its assignee (the task's own, else its nearest assigned parent's), the agent's vendor and model, the worktree, and elapsed time and tokens against a typical run. Up next is the queue `ndx work` picks from, each row with its assignee, under one line giving a typical run, such as "~12 min · ~41k tokens · ~$0.85". A row whose tier has at least three runs of its own shows that tier's figure. Estimates are medians of the last 30 days' finished runs, from `GET /api/hench/estimates`.

The top navigation has three stages: Analysis, Plan and Work. `/tune` opens Work on Tune and lights the Work tab. Up Next (the PRD dashboard), Audit and Workspaces are no longer on Work, because Live and Plan show the same numbers; their pages still open at their routes. In a Rex-only viewer the PRD Graph and Execution Log open as pages of their own.

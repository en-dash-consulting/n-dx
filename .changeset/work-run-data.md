---
"@n-dx/web": patch
---

Internal: the dashboard server reports who each live run and ready task is for, and `GET /api/hench/estimates` gives a typical run's duration, tokens and cost.

A run's or ready task's assignee is the task's own, else its nearest assigned parent's; a ready task also carries its saved tier. Estimates are medians of the last 30 days' finished runs from every worktree, overall and per tier once a tier has three runs. The Work page reads both.

---
"@n-dx/web": patch
---

Add `GET /api/live`: running hench runs from every worktree of the repository, running long jobs (including an analysis started from a terminal), the next tasks, a machine strip (agent slots, free memory against the hub floor, configured model, worktree count, spend today and in flight) and runs finished in the last hour. A `live:changed` WebSocket frame fires when a run or job starts, finishes or goes stale. The 5-minute stuck-run rule now lives in one place, so the bottom bar, runs health, audit and Live counts agree.

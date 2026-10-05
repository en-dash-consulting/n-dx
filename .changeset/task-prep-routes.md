---
"@n-dx/web": patch
---

Add the reads behind the Prepare task modal and the Ready to run list. `GET /api/hench/prep/:taskId` runs `ndx work --task=<id> --resolve` in the request's workspace and returns hench's resolved settings, sources and refusals plus the resolved vendor's model catalog, the hub's admission state (running, max, queued, available memory, pressure, memory-paused), the worktree's branch, anchor, dirty and live-run state, and `recommendation: null`; a failed or timed-out resolve answers 502 with the stderr tail. `POST /api/hench/prep/:taskId/preview` validates `{options}` against the run-option allow-list (400 naming the key) and returns the `--dry-run` brief. `GET /api/hench/ready?limit=N` lists the next tasks in `ndx work --auto` order, skipping tasks another worktree holds, and marks in-progress tasks with no live run as `resume`. The hub proxy now states its admission header, with the memory fields, on prep reads as well as `GET /api/live`.

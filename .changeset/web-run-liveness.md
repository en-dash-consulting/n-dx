---
"@n-dx/web": patch
"@n-dx/hench": patch
---

`GET /api/live` and `GET /api/hench/runs/health` report `liveness`, `livenessReason` and `canEnd` for each running run, in every worktree of the repository, with a per-verdict summary (`counts.liveness` and `liveness`). The verdict follows hench's rules — host, then the recorded pid and heartbeat, then that worktree's lock files — and a run the dashboard still holds as a child process is `live`. `runs/health` now spans every worktree and tags each run with its `worktree`. The web server has one `isPidAlive`, counting EPERM as alive.

---
"@n-dx/web": patch
---

Tracker sync rules turn ndx events into tracker calls through a connection, configured under `trackerSync` in `.n-dx.local.json`. Every rule is off until set; dry-run logs the would-be call; on makes moves automatically while creation and blocked raise cards. Each call carries `ndx:<project>:<rexId>:<event>`, duplicates are confirmed with a read, and a refusal is logged with its problems and never retried. `POST /api/tracker/sync/tick` (per-user token only) runs the queued events; `GET /api/tracker/activity` lists the log.

---
"@n-dx/web": patch
---

Add the Prepare task modal at `/work/prep/<taskId>`: every per-run `ndx work` option with its value and where it came from, per-run overrides marked with a reset, a preflight list that keeps Execute off while a refusal stands, the equivalent command line (built with the same argv builder the server spawns), a brief preview, and Execute with started, queued, refused and migratable outcomes. The prep response now also carries `dir` and the item's `detail` (priority, parent chain, criteria count).

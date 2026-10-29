---
"@n-dx/core": patch
"@n-dx/web": patch
"@n-dx/llm-client": patch
---

The hub now runs extension sidecars at `/x/<name>/`. The first request starts the sidecar on an ephemeral loopback port and waits up to 20 s for its `health` path; past that it answers 503 naming the log file under `<ndx home>/ext/<name>/logs/`. A sidecar with no request and no open WebSocket for `idleStopMinutes` is stopped, and `ndx hub stop` stops every one. A crashed sidecar restarts on the next request, backing off after three crashes in five minutes. None starts while available memory is at or below the hub's memory floor. The hub learns how to start each one from the new `ndx extensions sidecar <name> --json`, so discovery, approval and the config check stay in n-dx. `spawnManaged` gains a `logFile` option that appends a child's output to a file.

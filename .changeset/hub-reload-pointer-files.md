---
"@n-dx/core": patch
"@n-dx/web": patch
---

Hub-registered projects keep `ndx refresh --live-server` working (0.7.0 / PR 10).

After registering with the hub, `ndx start` writes `<dir>/.n-dx-web.port` naming the hub's port and `<dir>/.n-dx-web.pid` as `{ pid: hubPid, port, startedAt, via: "hub", projectId }`, so tooling that finds the dashboard through the port file keeps working. The reload signal now includes the sender's directory, and the hub routes `POST /api/reload` to the project whose repoRoot or registered worktree matches it — falling back to the sole registered project, or answering 409 naming the candidates when several are registered and none match.

The `via: "hub"` marker also guards the two legacy paths that would otherwise tree-kill the shared daemon: `ndx start stop` refuses with an explanation (hub-aware stop is the follow-up task), and `ndx refresh`'s conflicting-dashboard cleanup treats a hub pointer as no conflict.

---
"@n-dx/web": patch
"@n-dx/rex": patch
"@n-dx/core": patch
---

Fix eight defects found reviewing this branch: the hub's API now checks the
browser origin before registering a project (registration spawns a process);
the hub restates the forwarded `Origin` so dashboard mutations and WebSocket
upgrades work through the proxy in hub mode; the anchor's frames go out
untagged so the single-worktree dashboard updates live again;
`X-Ndx-Workspace` outranks the `/w/<key>/` slot, so the Workspaces board acts
on the worktree it names; `ndx start --here` relocates rather than SIGKILLing
the hub; the rex MCP path writes task claims (`claim_task`, `release_task`, and
on `in_progress`) instead of only reading them; workflow-template config
overlays go through the same allowlist as every other config writer; and a
malformed percent-escape in a URL no longer ends either server.

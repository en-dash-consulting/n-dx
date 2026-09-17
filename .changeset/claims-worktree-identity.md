---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Fix cross-worktree task claims under the dashboard and hub MCP endpoints. A
claim's owner is now its worktree alone; the pid is only a liveness check.
`ndx start` runs one rex MCP server per workspace inside a single process, so
every worktree's claim carried that one pid — and an ownership test that
accepted a matching pid let two worktrees hold the same task, let either
release the other's claim, and silenced the dashboard's own "another worktree
is working on this" refusal. `ClaimsStore.release` and `isClaimedByOther` now
take the asking worktree rather than a pid.

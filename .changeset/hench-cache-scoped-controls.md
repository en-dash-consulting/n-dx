---
"@n-dx/hench": patch
---

Add `hench cache` for inspecting and clearing the session cache by scope, and evict dead entries automatically.

`hench cache list` reports the orientation parent and the batch chain — session id, age, vendor and model, plus the worktree, ref, analysis fingerprint and policy hash a chain was opened under — and marks any entry that is dead for everyone with the reason. `hench cache clear` removes a scope (`--scope=parent|batch|all`), or with `--dead` removes only the dead entries, so dropping a stale chain no longer costs a good orientation parent.

Entries that are expired, idle past their window, unreadable, or written by another version of the cache schema are now swept automatically: every run evicts them from the scopes its session strategy does not read, and a task that fails ends its chain rather than handing the failure to the next task. Entries rejected only for identity — another worktree, another policy — are left alone, since they are the correct entry for the run that wrote them.

Also fixes `hench validate-tokens`, which had help text and a dispatch case but was rejected as an unknown command.

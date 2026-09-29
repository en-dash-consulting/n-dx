---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

The per-user directory the hub keeps its registry, pid and config in is now `~/.ndx/`, resolved by `resolveNdxHome` alongside the project-layout resolver rather than spelled out at each site.

Nothing moves on an existing machine: the lookup takes `$NDX_HOME`, then `$N_DX_HOME`, then `~/.ndx` if it exists, then `~/.n-dx` if it exists, and only a machine with neither starts on `~/.ndx`. A 0.7.x install keeps using `~/.n-dx` until it is migrated. An empty override is treated as unset.

`ndx start` now passes the resolved directory to a hub it spawns as `$NDX_HOME`, and the hub reports a bad config key by naming the resolved file rather than a tilde path that may not be the one in force.

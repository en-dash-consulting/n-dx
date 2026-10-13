---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/sourcevision": patch
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Windows: no more console windows from n-dx's child processes. `exec()` and `spawnCli` in llm-client gain a `windowsHide` option that defaults to true, and every other production spawn in the monorepo passes it; a new root policy test (`windows-hide-policy`) fails any spawn that does not. The vendor-CLI log `claude_commands.log` is now gitignored by `ndx init` and discounted by hench's uncommitted-work gate, so a fresh project's first agent run no longer refuses completion over it. The Overview page's isometric hero shows its Options button again.

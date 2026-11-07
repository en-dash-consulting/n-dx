---
"@n-dx/rex": patch
---

`rex next` and the MCP tool `get_next_task` pick only from the current branch's work set when it has one; `--any` (`any: true` over MCP) picks outside it. The default branch, a detached HEAD and a branch with no assignment select as before.

---
"@n-dx/core": patch
---

`ndx init --no-llm` initializes a project with no model call, no vendor CLI spawn and no network request, for batch runs over many repositories.

Under `--no-llm`, init skips the vendor auth check, the `claude` lookup behind MCP registration (`--mcp-scope=local` registers nothing) and the update check, and it never prompts. It prints one line naming what it skipped, and the summary reads `Model features  not checked (--no-llm)`. The vendor is recorded only from `--provider` or existing config, unchecked; with neither, init leaves it unset instead of stopping. No `claude_commands.log` is written. Init's analysis was already `--fast`.

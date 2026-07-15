---
"@n-dx/core": patch
---

Register MCP servers using the discovered claude CLI path instead of a bare `claude` literal. `registerMcpServers` computed `claudeCmd = discovery.path` but the `claude mcp remove` / `claude mcp add` commands still shelled out to the literal string `claude`, requiring it on `PATH`. When `discoverClaudeCli` resolved claude at a well-known location that is not on `PATH` — notably Windows `%APPDATA%\npm\claude.cmd` / `claude.exe`, but also nvm and Homebrew installs — `ndx init` silently failed to register the rex and sourcevision MCP servers even though discovery had succeeded. Both commands now invoke the quoted discovered path, so MCP registration works on installs where claude is not on `PATH`.

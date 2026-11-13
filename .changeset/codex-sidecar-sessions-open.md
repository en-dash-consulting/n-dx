---
"@n-dx/web": patch
---

Sidecar (experimental, off by default; enable with `web.sidecar`) supports Codex worktree sessions and turns; hub sessions stay Claude-only.

Every Codex turn, fresh and resumed, re-reads each project `.codex/config.toml` from the checkout up to the repository root and turns off every MCP server it declares except `ndx-sidecar`. Each receives a complete disabled entry: `-c mcp_servers.<name>.enabled=false` plus a placeholder `command` for stdio or `url` for HTTP. The entries are valid whether or not Codex loads the project file. An unreadable or unsupported project config, a server name that is not a bare TOML key, or a server declaring neither or both transports refuses the turn before anything is spawned, with a reason naming the file. User configurations selecting a non-default model provider remain unsupported.

Action needed: If a turn refuses a project config, repair the named `.codex/config.toml`; use bare server names and exactly one `command` or `url` per server. For a non-default Codex provider, select Claude for the Sidecar.

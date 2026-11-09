---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Codex Sidecar turns start in an `ndx init`'d repo on codex-cli 0.166.0. Each project MCP server is now turned off with a complete disabled entry (`enabled=false` plus a placeholder `command` or `url`), valid whether or not Codex loads the project `.codex/config.toml`; a server declaring neither or both transports refuses the turn. A turn that still reaches an MCP server other than `ndx-sidecar` is stopped, and the reason is shown.

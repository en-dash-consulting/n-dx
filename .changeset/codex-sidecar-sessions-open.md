---
"@n-dx/web": patch
---

Codex Sidecar sessions are no longer refused: a worktree session can be created on Codex and its turns spawn. Hub sessions stay Claude-only. Every Codex turn, fresh and resumed, re-reads each project `.codex/config.toml` from the checkout up to the repository root and turns off every MCP server it declares except `ndx-sidecar` (`-c mcp_servers.<name>.enabled=false`). A project config that exists but cannot be read with confidence refuses the turn with a reason naming the file, and nothing is spawned.

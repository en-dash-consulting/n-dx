---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Run the Claude CLI that `ndx work` drives inside the same OS sandbox as the agent's tool commands: the project read-write except hench's own config, the CLI's own config and login, the n-dx install its MCP servers start from, TLS and loopback network only, and no access to the operator's other credential directories. Codex keeps its own `--sandbox workspace-write` confinement. Autonomous Claude runs refuse to start unconfined unless the operator opted out.

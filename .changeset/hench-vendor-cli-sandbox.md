---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Run the Claude CLI that `ndx work` drives inside the same OS sandbox as the agent's tool commands: the project read-write except hench's own config, the CLI's own config and login, the n-dx install its MCP servers start from, and no access to the operator's other credential directories. On macOS its network is TCP 443 to any host, the system resolver, loopback (every local TCP port) and Unix sockets inside the project and scratch directories; on Linux bubblewrap cannot filter the network, so the CLI shares the host network unrestricted. Codex keeps its own `--sandbox workspace-write` confinement. Autonomous Claude runs refuse to start unconfined unless the operator opted out.

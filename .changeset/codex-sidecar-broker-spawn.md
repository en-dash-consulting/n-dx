---
"@n-dx/web": patch
---

Codex Sidecar (experimental, off by default; enable with `web.sidecar`) connects turns to the broker under a read-only policy.

Codex Sidecar turns, fresh and resumed, spawn with `--ignore-user-config`, `features.apps=false`, `features.shell_snapshot=false`, the read-only policy (re-applied on resume) and the `ndx-sidecar` broker as `-c mcp_servers.ndx-sidecar.*` flags: url, `required`, a 30 s startup timeout and a tool timeout of the session idle window. The broker headers travel as `env_http_headers` variables set only in the Codex child's environment and blanked in the agent's commands, so the credential is never in argv or an MCP config file. Other project MCP servers receive complete disabled entries (`enabled=false` plus a placeholder `command` or `url`).

---
"@n-dx/web": patch
"@n-dx/llm-client": patch
---

The experimental dashboard `Sidecar` (`web.sidecar`, off by default) carries selected Codex provider credentials securely and honors configured model pins on fresh and resumed turns.

Action needed: custom providers require codex-cli `0.167.0-alpha.3.2` and a Responses provider in the operator's Codex config. Export required credential variables before starting the dashboard. Command-backed authentication, OAuth and unsupported provider settings refuse explicitly; no provider fallback occurs.

Only the selected provider and profile model are carried. Unrelated MCP servers and integrations remain excluded, and hub sessions retain their existing audited executable and sandbox restrictions. Provider credentials travel through hidden environment references, including static headers and bearer tokens in the confined hub, and are masked in agent commands. Worktree sessions require environment-backed credentials. Explicit session models override the project's Codex model pin, which overrides the selected Codex profile model.

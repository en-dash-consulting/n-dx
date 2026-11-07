---
id: "56befbd4-e797-4826-8284-87e789c4405c"
type: "change"
title: "A project MCP server whose name is not a bare TOML key may stay enabled in a Codex Sidecar turn, because its quoted -c path is unverified on the real CLI"
slug: "a-project-mcp-server-whose-name-is-not"
intent: "Verdict: should-fix (severity medium). Found by the adversarial review of task 0b3b3a8c (run 266dcbab).\n\npackages/llm-client/src/codex-project-config.ts (codexProjectMcpDisableFlags, last lines) disables a project server named outside [A-Za-z0-9_-] with `-c mcp_servers.\"<name>\".enabled=false` (JSON-quoted segment), as the task asked. Whether codex's -c override parser honours a quoted path segment was never tested on the real CLI. If it splits the path on '.' without TOML key parsing, `[mcp_servers.\"my server\"]` gets the override under a key with literal quotes, and `[mcp_servers.\"a.b\"]` under mcp_servers -> \"a -> b\" — both miss, and the server stays enabled.\n\nFailure scenario: a repository's .codex/config.toml declares `[mcp_servers.\"x.y\"] command = \"...\"`. A Codex Sidecar turn in that checkout spawns codex with a disable flag that does not match, so if Codex loads project config, that server's command runs alongside the broker.\n\nReachability: worktree Codex Sidecar sessions in a checkout whose .codex/config.toml names a non-bare server. ndx init writes only bare names (rex, sourcevision). Whether Codex loads project config at all under --ignore-user-config (no trust entry) is also unverified, so this is defence in depth, not a known live hole.\n\nOptions:\n- A (recommended): fail closed — refuse the turn, naming the file and the server, when any declared name is not a bare key. Cheap; ndx-written configs are unaffected. Contradicts the operator note that said to quote, so it needs the operator's decision.\n- B: verify on the real codex CLI that a quoted -c segment applies (a fixture with a spaced and a dotted name, check `codex exec` loads no such server), then keep quoting and pin the result in a test comment.\nUntrusted-repository constraint applies: repository content must not widen what n-dx runs.\n\nOperator decision (2026-11-06, PR 3): option A. Refuse the turn, naming the file and the server, when any declared project MCP server name is not a bare TOML key ([A-Za-z0-9_-]+); emit no quoted -c path. This supersedes the earlier note to quote such names. Option B needs the real Codex CLI, which is Ryan's live check. Keep ndx-sidecar excluded as before. Add a @n-dx/llm-client patch changeset (and @n-dx/web if it changes)."
acceptanceCriteria:
  - "A Codex Sidecar turn in a checkout whose .codex/config.toml declares a server named \"a.b\" or \"my server\" refuses the turn with a reason naming the file and the server, and spawns nothing"
  - "A unit test covers a dotted and a spaced server name and asserts the refusal; bare names (rex, sourcevision) still get -c mcp_servers.<name>.enabled=false"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
discoveredFrom: {"item":"0b3b3a8c-f6d7-44ec-b289-8c6a2e57205c","run":"266dcbab-7c06-4380-81f6-a48ea9348766"}
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---

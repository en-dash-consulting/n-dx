---
id: "d1e807c8-af53-438c-9b13-a7153e3c48bb"
type: "task"
title: "Broker re-exposes external tools to the Sidecar session and carries out their calls"
slug: "broker-re-exposes-external-tools-to"
description: "Story 41, part 2. createBrokerMcpServer (packages/web/src/server/sidecar/broker-mcp.ts) registers, for a worktree-scope session, every external tool whose policy is not never, under its wire name, with the server's description prefixed by its display name and its JSON input schema passed through (validation stays with the external server). A run-policy call is carried out at once and returns the server's content; an ask-policy call raises a new \"external-call\" card (kind added to SidecarCardKind and broker-policy.ts, never allow-listable) showing the connection, tool display name, class and the arguments as JSON (task 43 turns it into a form), carried out only on Approve. An unavailable connection's tools stay listed and a call returns isError text \"connection unavailable: <reason>\" (or \"sign in again\" for needs-sign-in) without raising a card; the session keeps working. The external server's isError results are passed back unchanged. Hub-scope sessions get no external tools in C1. Codex: the broker is the only MCP server either vendor's session has, so the external tools reach Codex through the same broker endpoint; add a test that drives the broker endpoint with the SDK Client as both vendors do, and one that the Codex spawn config still names only the broker. Follow the shared rules in the parent change's description (config only in .n-dx.local.json, tokens only from connection:<id> via connection-credentials.ts, no child env token, nothing tracker-specific, fake servers and a temp ndx home in tests, no AGENTS.md edits under packages/web, nothing turns on web.sidecar)."
acceptanceCriteria:
  - "A worktree session's broker tools/list includes each fake server's tools under <id>__<tool>, omits never-policy tools, and is unchanged when no connection is configured (integration test with the SDK Client against the broker endpoint)"
  - "A run-policy read returns the fake server's result with no card; an ask-policy write raises an external-call card and reaches the fake server only after Approve, and Deny returns a refusal with no call (tests)"
  - "With the fake server down, its tools' calls return 'connection unavailable' with no card and other broker tools keep working (test)"
  - "external-call cards are never allow-listable (allowListKey returns null) and hub-scope sessions list no external tool (tests)"
  - "The Claude and Codex spawn configs still name only the ndx-sidecar broker; no external server reaches a vendor's own MCP config (spawn-policy tests)"
  - "Web suite, tests/e2e/architecture-policy.test.js, domain-isolation and cross-package-contracts pass with no ceiling change"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---

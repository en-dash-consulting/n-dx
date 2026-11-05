---
id: "991e785d-b0f2-4893-bcf8-1dc135f7ba16"
type: "task"
title: "Connection service: connect to operator-added MCP servers and list their tools under a namespace"
slug: "connection-service-connect-to-operator"
description: "Story 41, part 1 (CAOS 3f7a80b7-1924-811a-afc7-edb86c8706cc). A generic MCP client service in packages/web/src/server/connections/: load connections from .n-dx.local.json (ignore and warn once on a tracked .n-dx.json block), connect each lazily with the SDK Client over StreamableHTTPClientTransport (url) or StdioClientTransport (command), keep one live client per connection for the server's life with reconnect on next use after a failure, cache tools/list (refresh on reconnect and on notifications/tools/list_changed), and expose: list connections with state (connected | unavailable with reason | needs-sign-in), list tools as { connection, tool, displayName: \"<id>.<tool>\", wireName: \"<id>__<tool>\", description, inputSchema, annotations }, and callTool(connection, tool, args, signal). auth \"token\" sends Authorization: Bearer from connection:<id> (read on every connect, never cached on disk); a missing token reads needs-sign-in. auth \"oauth\" is a hook left for task 49a (needs-sign-in until then). Wire names use \"__\" because the Claude and OpenAI tool-name patterns reject dots; a wire name over 64 characters is skipped with a warning naming it. Write docs/architecture/sidecar-connections.md (the three layers, config shape, the decisions). Follow the shared rules in the parent change's description (config only in .n-dx.local.json, tokens only from connection:<id> via connection-credentials.ts, no child env token, nothing tracker-specific, fake servers and a temp ndx home in tests, no AGENTS.md edits under packages/web, nothing turns on web.sidecar)."
acceptanceCriteria:
  - "A fake HTTP MCP server and a fake stdio MCP server declared in .n-dx.local.json each list their tools as <id>.<tool> (wire name <id>__<tool>); a tracked .n-dx.json connections block is ignored and warns once (unit tests)"
  - "auth token sends the connection:<id> value as a Bearer header read from a temp-home credential store; with no stored value the connection reads needs-sign-in and nothing is sent (test)"
  - "A stdio connection's child env is the sanitized environment plus only its configured literal env: a test sets a secret-looking variable and a connection:<id> entry and asserts neither reaches the child"
  - "A server that refuses, times out or exits reads 'connection unavailable' with its reason, other connections keep working, and the next call reconnects (test)"
  - "packages/web/src/server/connections/ names no tracker, CAOS tool or status (a test greps for caos|work_item)"
  - "Only connection-credentials.ts imports the credential-store functions in packages/web/src (policy test), and the web suite plus tests/e2e/architecture-policy, domain-isolation and cross-package-contracts pass"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---

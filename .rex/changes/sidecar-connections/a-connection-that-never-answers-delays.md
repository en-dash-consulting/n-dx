---
id: "b9ab5436-8b42-44ce-bfa8-4f15fc911275"
type: "task"
title: "A connection that never answers delays every Sidecar turn's tool listing by the connect timeout"
slug: "a-connection-that-never-answers-delays"
description: "Verdict: should-fix (ndx-adversarial-review of d1e807c8). Severity medium.\n\nScenario: .n-dx.local.json declares a connection whose host accepts the TCP connection and never answers (a hung server, a proxy black-holing it). Every Sidecar turn spawns the vendor CLI, which calls the broker's tools/list. handleBrokerMcpRequest then runs ConnectionService.listTools() over every connection (packages/web/src/server/sidecar/broker-mcp.ts, connectionsNeeded -> \"all\"), and ensure() retries connect() on the unavailable slot each time (packages/web/src/server/connections/connection-service.ts, ensure/connect), waiting the full connectTimeoutMs (10 s by default) before the listing answers. So every turn starts up to 10 s late for as long as that server hangs, though the call-path fix in the same review means calls to other connections no longer wait.\n\nReachable: yes, through the real route POST /api/sidecar/sessions/:id/mcp on every turn while any declared connection is silent. Not covered by any test: the integration test only asserts that a call to one connection skips the others.\n\nOptions:\n1. (Recommended) Back off reconnect for listing: after a connect failure, listTools serves the slot's last-known tools (or none) without reconnecting until a retry interval passes (for example 30 s, doubling to a cap). A call to that connection still reconnects at once. Cost: one timestamp per slot plus a test. Risk: a server that recovers is seen up to one interval late in the tool list.\n2. Reconnect in the background: tools/list never awaits a connect for an unavailable slot, and kicks one off without waiting. Cost: similar, plus care that a background connect does not outlive close(). Risk: the first listing after the server recovers still lacks its tools.\n3. Shorten the connect timeout for listing only. Cheapest, but still delays every turn."
acceptanceCriteria:
  - "With one connection whose server accepts and never answers, a second tools/list on the broker, made within the retry interval after the first failed, sends no request to that server (test counts requests, no wall-clock assertion)"
  - "A call to that connection's tool still attempts a reconnect, and a server that recovers is listed again once the interval passes (test)"
  - "A connection that fails then recovers keeps its last-listed tools in the broker's list while backing off"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "sidecar"
source: "ndx-adversarial-review"
---

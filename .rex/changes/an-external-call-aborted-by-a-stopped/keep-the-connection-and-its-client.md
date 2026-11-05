---
id: "00773f12-af76-49d7-8d09-bbdf70c232a9"
type: "task"
title: "Keep the connection and its client when a caller aborts an external call"
slug: "keep-the-connection-and-its-client"
description: "Implements the parent change (found by the review of b59456bd, run 96d0cf25). In ConnectionService.callTool (packages/web/src/server/connections/connection-service.ts), when the caller's own signal is aborted, do not call fail(): rethrow as an abort and keep the client and the connection's status (option A in the parent). A call that hits the service's own call timeout still marks the connection unavailable. Tests against the fake HTTP server (packages/web/tests/helpers/fake-mcp-http-server.ts), never CAOS. Do not edit packages/web/AGENTS.md or src/server/AGENTS.md. Add a patch changeset for @n-dx/web."
acceptanceCriteria:
  - "A callTool aborted through its caller's signal leaves the connection's status connected and its client open (test against the fake HTTP server)"
  - "A call that genuinely times out (the service's own call timeout) still marks the connection unavailable (test)"
  - "Another call in flight on the same client completes when a different call is aborted (test)"
  - "Stopping a turn mid external call does not change what Settings > Connections reports for that connection"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-adversarial-review"
---

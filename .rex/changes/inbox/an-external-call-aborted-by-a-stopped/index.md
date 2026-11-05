---
id: "2c4ff2f9-7d31-4274-9f75-27b4bba4ec15"
type: "change"
title: "An external call aborted by a stopped turn marks its connection unavailable and drops its client"
slug: "an-external-call-aborted-by-a-stopped"
intent: "Found by the adversarial review of task b59456bd (run 96d0cf25); pre-existing, from the broker's external-tool carry-out (task \"Broker re-exposes external tools…\"), not introduced by that task. Verdict: out-of-scope.\n\nScenario: a Sidecar turn calls an external tool (run, or ask then Approve); the operator stops the turn while the server is still answering. broker-mcp.ts passes broker.carryOutSignal() to ConnectionService.callTool; the abort reaches the MCP SDK, which over Streamable HTTP rejects with McpError -32001 (RequestTimeout, message \"AbortError: This operation was aborted\"). isConnectionFailure (packages/web/src/server/connections/connection-service.ts:160-163) counts RequestTimeout as a connection failure, so fail() marks the connection unavailable with that reason and closes its client. Settings > Connections then reads the connection as unavailable (\"MCP error -32001: AbortError…\") until the next call reconnects, and any other call in flight on that client (another session's read) is cut off.\n\nEvidence: reproduced while fixing the hint read in external-call.ts; an aborted callTool against the fake HTTP server left status { state: \"unavailable\", reason: \"MCP error -32001: AbortError: This operation was aborted\" }.\n\nReachable: yes, Stop on a turn mid external call (routes-sidecar interrupt → broker.withdraw aborts carrying signals).\n\nOptions: (A, recommended) in callTool, when the caller's signal is aborted, do not call fail(): rethrow as an abort and keep the client — cheap, one branch and a test. (B) classify by the SDK error's cause instead of its code — more precise but depends on SDK internals."
acceptanceCriteria:
  - "A callTool aborted through its caller's signal leaves the connection's status connected and its client open (test against the fake HTTP server)"
  - "A call that genuinely times out (the service's own call timeout) still marks the connection unavailable"
  - "Stopping a turn mid external call does not change what Settings > Connections reports for that connection"
priority: "low"
discoveredFrom: {"item":"b59456bd-36ac-4409-9707-6f30c2844f89","run":"96d0cf25-1e4f-4b59-8a6e-a844323da1b7"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---

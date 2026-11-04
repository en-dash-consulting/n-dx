---
id: "cd5defa2-2edd-43e1-9de4-768a1584e660"
type: "task"
title: "A connection's unavailable reason carries the server's raw error body, which can echo the token"
slug: "a-connection-s-unavailable-reason"
description: "Found by ndx-adversarial-review of task 991e785d (verdict should-fix, severity low).\n\nScenario: an HTTP connection with auth \"token\" whose server answers a non-OK status (e.g. 500) with a body that echoes request headers. The SDK's StreamableHTTPError message is `Error POSTing to endpoint (HTTP 500): <body>`; ConnectionService.connect (packages/web/src/server/connections/connection-service.ts, catch in connect()) and callTool store errorMessage(err) verbatim as status.reason. The reason reaches listConnections() and, once the Settings task serves it, an API response and possibly logs — so a stored connection:<id> token can leave the store through a reason string, against the change's rule \"never print, log or persist a credential value outside the store\".\n\nReachability: today nothing serves listConnections; the Settings task (sign-in flow / Settings lists connections) will. Requires a server that echoes the header — the server already has the token, so the exposure is to the dashboard/log, not to a new party.\n\nOptions: (a) recommended — scrub the reason: replace the exact token value (read in transportFor) with its credentialFingerprint and pass the result through llm-client redactSecrets; cheap, keeps the reason useful. (b) drop the HTTP body from reasons and keep only the status code; simplest, loses server diagnostics. (c) cap reason length plus (a)."
acceptanceCriteria:
  - "A test with a fake HTTP server that answers 500 with a body containing the stored token asserts the connection's status.reason does not contain the token value"
  - "The same holds for a callTool failure's ConnectionUnavailableError message"
  - "A reason still names the HTTP status so the operator can diagnose the failure"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---

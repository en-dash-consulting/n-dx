---
id: "543791ca-c73f-45af-998d-6022109e3758"
type: "task"
title: "Editing a tool's policy or a connection's profile in Settings closes its live client and aborts calls in flight on it"
slug: "editing-a-tool-s-policy-or-a"
description: "Found by the adversarial review of task 920b0ec3 (run d7816262). Verdict: should-fix, severity medium.\n\nScenario: a Sidecar session (or a tracker sync tick) is mid tools/call on connection `caos`. The operator changes any tool's policy or the connection's profile in Settings > Project > Connections. The route writes config and calls ConnectionService.reload() (routes-connections.ts tools/profile branches); reload compares the declaration by JSON, sees the `tools` (or `profile`) field changed, and calls reset() on the slot, which closes the live client (connection-service.ts reload → reset → live.client.close()). The in-flight callTool rejects with ConnectionClosed, isConnectionFailure counts it, and the caller gets ConnectionUnavailableError (\"not connected yet\") although the server may already have executed the write. Tracker sync's confirmation reads cover duplicates there; a Sidecar external write reports failure for a call that may have happened.\n\nReachable: yes, any tool/profile edit while a call is running on that connection.\n\nOptions:\n(A, recommended) In reload, when only `tools` overrides (or `profile`, `fieldHints`, `label`) changed, keep the live client and re-resolve the cached tools' policies in place (resolveToolPolicies over the live tools); reconnect only when transport, url, command, args, env or auth changed. Cost: a field split and a test; no reconnect on policy edits.\n(B) Keep closing, but defer close() of the old client until its in-flight calls settle (track a per-live in-flight count). Covers transport changes too; more state."
acceptanceCriteria:
  - "A tools/call in flight on a connection completes with the server's result when the operator changes a tool's policy on that connection meanwhile (test against the fake HTTP server with a slow tool)"
  - "A policy or profile edit does not reconnect the connection (the fake server sees no new initialize)"
  - "A url, command or auth change still reconnects on next use"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---

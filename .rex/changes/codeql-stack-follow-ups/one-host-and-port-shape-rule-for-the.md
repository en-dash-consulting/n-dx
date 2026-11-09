---
id: "0ced7222-2378-48d2-a973-21058691a7ae"
type: "task"
title: "One host and port shape rule for the local LLM endpoint across CLI, dashboard and inference"
slug: "one-host-and-port-shape-rule-for-the"
description: "Layer 5 of stack #855 shape-checks llm.local.host and llm.local.port on the dashboard routes. ndx config llm.local.host (core config.js ~1196) still accepts a host carrying a path, credentials or a second port; a string-typed saved port is treated as absent by the dashboard (probing 1234) while local-api-provider.ts uses it for inference; and local-api-provider.ts builds http://host:port from the saved config with no shape check, so a hand-edited .n-dx.json reaches the URL sink unvalidated. Tier rules: core imports nothing (inline the rule, pin it with a parity test like windows-quoting-parity), llm-client can own the exported rule, web may import it if a web-to-llm-client path exists (check docs/architecture/gateways.md) or keep its copy pinned."
acceptanceCriteria:
  - "ndx config llm.local.host refuses a host with a path, userinfo, second port or whitespace and accepts localhost, 127.1, [::1] and a LAN name"
  - "A string-typed saved port is reported as invalid by the dashboard rather than silently replaced by 1234"
  - "local-api-provider refuses an invalid saved host or port with a clear error before building the URL"
  - "The copies of the rule are held equal by a test"
priority: "low"
source: "codeql-triage"
---

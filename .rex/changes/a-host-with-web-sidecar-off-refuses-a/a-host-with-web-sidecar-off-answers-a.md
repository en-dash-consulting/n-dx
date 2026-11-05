---
id: "5372715a-cb29-4148-93bc-960b753c8b7f"
type: "task"
title: "A host with web.sidecar off answers a hub session upgrade with 403"
slug: "a-host-with-web-sidecar-off-answers-a"
description: "Apply the web.sidecar route gate on the project server's upgrade path for /api/sidecar/hub/ paths only, so the hub's existing upgrade failover (upgradeHubSession in src/hub/proxy.ts) sees the refusal it waits for."
acceptanceCriteria:
  - "A project server with web.sidecar off answers an upgrade for an /api/sidecar/hub/ path with 403 and FEATURE_DISABLED_HEADER set to web.sidecar, reading the flag per request as the HTTP gate does, and writes no 101"
  - "Upgrades for every other path, and hub-session upgrades with web.sidecar on, behave as before"
  - "An integration test upgrades through the hub against two real project servers (startServer), the first with web.sidecar off, and the socket is connected to the second"
priority: "medium"
source: "adversarial-review"
---

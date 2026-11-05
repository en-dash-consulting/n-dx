---
id: "277b2784-78bb-42d9-b27a-a599ae1cbd41"
type: "task"
title: "Settings > Connections waits the full connect timeout on every load while a connection's server hangs"
slug: "settings-connections-waits-the-full"
description: "Found by adversarial review of 98f4d418 (run ccf92da8). Verdict: should-fix (medium).\n\nScenario: .n-dx.local.json declares an HTTP connection whose server accepts the TCP connection but never answers (or a stdio command that never completes the handshake). Opening Settings > Project with web.sidecar on calls GET /api/connections, whose handler awaits ConnectionService.listConnections(). listConnections (packages/web/src/server/connections/connection-service.ts) awaits ensure() for every slot with no backoff, unlike listTools, which skips a slot inside its retry interval. So every load of the section blocks for DEFAULT_CONNECT_TIMEOUT_MS (10 s) before any connection is shown, and a stdio command that fails is spawned again on each load.\n\nReachable: yes, from the dashboard's Settings > Project page (routes-connections.ts GET /api/connections), on every visit while web.sidecar is on.\n\nOptions:\n1. (Recommended) Give listConnections the same backoff as listTools: skip ensure() for a slot that is backingOff(). The first load after a failure still waits; later loads in the retry window answer at once with the last status. Cheap; it only touches listConnections and one test.\n2. Have GET /api/connections report the current status without connecting (connection(id) for each slot), and connect in the background. The page loads instantly, but a connection never used yet reads \"not connected yet\" until the Sidecar touches it, which reads worse."
acceptanceCriteria:
  - "After a connection's connect fails, a second GET /api/connections inside its retry interval answers without attempting to connect it again (test with a fake server that never answers and a short connect timeout)"
  - "A stdio connection whose command fails is not spawned again by a listing inside its retry interval"
  - "A connection that was never tried is still connected by the first listing"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---

---
id: "9eab4203-22e3-41df-b3d8-7eb300ec0ca3"
type: "change"
title: "A host with web.sidecar off refuses a hub session socket"
slug: "a-host-with-web-sidecar-off-refuses-a"
intent: "Follow-up to change 89e6dabf (PR #951), from Hal's adversarial review on 2026-11-04, finding F1, medium, should-fix; option 1 decided. The hub's upgrade failover waits for a 403 with x-ndx-feature-disabled: web.sidecar, but a project server's upgrade handler (server.on('upgrade') in src/server/start.ts, then ws.handleUpgrade) never applies the route feature gate, so a real host with the feature off answers 101 and the drawer's socket stays on a host whose turns fail over elsewhere. The existing test passes only because its stub upstream answers the upgrade with that 403."
acceptanceCriteria:
  - "Hub session WebSocket failover works against real project servers, not only stub upstreams"
  - "Nothing in this change turns on web.sidecar"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
discoveredFrom: {"item":"89e6dabf-b024-45bb-9be1-b09796a724d3"}
source: "adversarial-review"
---

---
id: "3cb484e4-8668-491e-8927-268164c5d410"
type: "task"
title: "A WebSocket client that leaves during a sidecar cold start is still forwarded and counted"
slug: "a-websocket-client-that-leaves-during"
description: "Verdict: must-fix (breaks H1's criterion 'does not open an upstream request' for upgrades). upgradeSidecar (packages/web/src/hub/proxy.ts:736) checks only socket.destroyed after awaiting ensure(); after 'upgrade' Node detaches the parser's end handler and the server socket is half-open-allowed, so a client that destroy()s during the start leaves the hub socket ended but not destroyed (observed destroyed=false ended=true). The upgrade is then counted (openSocket) and forwarded; with a sidecar that holds the handshake, no idle stop ever happens. Confirmed end to end against the built hub. Fix: before awaiting ensure, attach socket 'end'/'close' listeners that set a gone flag, and test gone || socket.destroyed || socket.readableEnded; add an upgrade twin of the cold-start hub test."
acceptanceCriteria:
  - "An upgrade whose client leaves during the sidecar's start is neither counted nor forwarded"
  - "A hub-level test aborts a WebSocket during a slow start and observes the idle stop"
  - "Reverting the guard fails that test"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---

---
id: "28b36086-bfff-4cc8-9ace-087fe2a03360"
type: "task"
title: "A client disconnecting during a sidecar cold start leaks its in-flight count, so the sidecar is never idle-stopped"
slug: "a-client-disconnecting-during-a"
description: "Verdict: must-fix. handleProxyRequest case sidecar (packages/web/src/hub/proxy.ts:469-477) awaits hub.sidecars.ensure (up to ~20 s), then calls beginRequest and registers res.once('close') after the close may already have fired; inflight stays 1 and sweepIdle (sidecars.ts:273) never stops it. proxyHttp then pipes a destroyed req, leaving a hung upstream socket. The WebSocket path has the guard (proxy.ts:715), the HTTP path does not. Also: tests call beginRequest/openSocket directly (hub-sidecars.test.ts:125), so removing the proxy's wiring fails nothing. Fix (recommended): record a close flag before awaiting ensure and skip beginRequest and the proxy when set; add a hub-level test that aborts a request during a slow start and asserts the idle sweep stops the sidecar, and tests that fail if the proxy's beginRequest/openSocket wiring is removed."
acceptanceCriteria:
  - "A request aborted while its sidecar starts does not leave an in-flight count and does not open an upstream request"
  - "A hub-level test aborts a request during a slow start and observes the idle stop"
  - "Removing the proxy's beginRequest or openSocket wiring fails a test"
priority: "high"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---

---
id: "87b82506-45db-4b52-bd8c-30e1c46807d2"
type: "task"
title: "A request a host refuses on web.sidecar is answered by the next host, not with the 403"
slug: "a-request-a-host-refuses-on-web"
description: "H1 follow-up. src/hub/proxy.ts's hub-session case marks a host skipped when it answers 403 with x-ndx-feature-disabled: web.sidecar, but streams that 403 to the client, so the first request after a refusal fails. Retry the same request on the next healthy host instead."
acceptanceCriteria:
  - "When the picked host answers 403 with x-ndx-feature-disabled: web.sidecar, the hub marks it skipped and sends the same request (method, path, headers and body) to the next healthy host; the client sees only that host's answer"
  - "The request body is buffered up to a fixed limit before forwarding so it can be replayed; a larger body is refused with 413 rather than forwarded without a replay"
  - "The 403 naming web.sidecar reaches the client only when no healthy host remains"
  - "A WebSocket upgrade refused by one host is retried on the next before the client's socket is answered"
  - "Tests in hub-session-proxy.test.ts cover a GET, a POST with a body and a WebSocket upgrade each failing over past a sidecar-off host on the first request"
priority: "medium"
source: "adversarial-review"
---

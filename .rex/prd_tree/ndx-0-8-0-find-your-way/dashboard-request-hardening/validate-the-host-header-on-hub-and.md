---
id: "25746a2d-4197-4369-be91-3ef099dcad2e"
level: "task"
title: "Validate the Host header on hub and dashboard server requests"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "request-hardening"
  - "web"
source: "0.8.0 request hardening (2026-10-01)"
acceptanceCriteria:
  - "The hub answers 421 to GET /api/hub/overview and to GET /p/<id>/api/status when Host is any name other than localhost, 127.0.0.1 or [::1] on its port, and 200 for each of those three names (integration test)."
  - "A directly started project server answers 421 to GET /api/status with a foreign Host and 200 with each loopback name (integration test)."
  - "A WebSocket upgrade with a foreign Host is refused by both the hub and a project server (test)."
  - "A request proxied by the hub to a project server still succeeds, and the ndx CLI and MCP-over-HTTP calls through the hub still work (existing tests pass, plus one proxied request in the new test)."
  - "A request with no Host header, or with Host given twice, is refused (unit test of isLoopbackHostOnPort)."
  - "packages/web/CLAUDE.md states the Host rule, and the comment in request-security.ts is corrected."
  - "A .changeset file bumps @n-dx/web as patch."
description: "Today only the Origin header is checked: `guardHubRequest` (`packages/web/src/hub/request-guard.ts`) and `handleRequestSecurity` (`packages/web/src/server/request-security.ts`, called at the top of the request handler in `server/start.ts`) refuse mutating requests with a foreign Origin, but a GET with no Origin is served whatever its Host header says. Add a Host check to both, ahead of the existing Origin logic.\n\nImplementation notes:\n- Add `isLoopbackHostOnPort(host, port)` to `packages/web/src/shared/origin.ts`, next to `isLoopbackOriginOnPort`, and export it through `shared/index.ts`. Accept `localhost`, `127.0.0.1` and `[::1]` with exactly the socket's local port (`req.socket.localPort`). Reject a missing Host, a Host given more than once, and any other name or port.\n- Hub: call it first in `guardHubRequest` for every method, and on the WebSocket upgrade path the hub guards (the upgrade handling next to `guardHubRequest`). Refuse with 421 Misdirected Request and a short JSON body, `Cache-Control: no-store`.\n- Project server: call it first in `handleRequestSecurity`, and on the server's WebSocket upgrade check (`server/websocket.ts`). The hub's proxy (`hub/proxy.ts`) already rewrites Host to `127.0.0.1:<child port>` for the child, so proxied requests pass and only direct requests are judged; keep it that way.\n- Check whether the preview server (`server/preview.ts`) answers browser requests and, if it does, apply the same guard.\n- Correct the comment above `isTrustedBrowserOrigin` in `request-security.ts`, which currently says the Origin comparison is what protects against a request presenting a matching Host value; the Host check is what does that for requests without an Origin.\n- Add one line on the Host rule to `packages/web/CLAUDE.md` where the request security rules are described.\n\nConstraints that apply to every n-dx change: cross-package imports only through the package's gateway module; `src/shared/` stays framework-agnostic with no upward imports (boundary-check.test.ts); every user-facing change carries a changeset with the scoped package name and a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-01T15:48:26.266Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

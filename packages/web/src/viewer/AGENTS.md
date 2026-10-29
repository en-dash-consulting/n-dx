# `src/viewer/`

## Web viewer gateway boundary

> Applies to `src/viewer/`, `src/shared/` and `src/schema/`.
> `.claude/rules/web-gateway-boundary.md` scopes this section to those paths for
> Claude Code; the text lives here so every assistant reads it.

Within the web package, `src/viewer/external.ts` concentrates all viewer-side imports
from `src/viewer/messaging/`, `src/shared/`, and `src/schema/`. `RequestDedup` is
canonically located in `src/viewer/messaging/request-dedup.ts` and re-exported through
`external.ts` for viewer consumers.

**Type-import exemption:** the root gateway rule (see the root `AGENTS.md`) requires
`import type` to flow through gateways too, to prevent type-import promotion erosion.
Web viewer files are exempt from this because the server/viewer boundary prevents them
from reaching the server-side gateway.

**Messaging exemption:** `src/viewer/messaging/` files may import directly from
`src/shared/` without going through `external.ts`. The shared/ directory is neutral
(neither server nor viewer), and messaging utilities access it directly to avoid
zone-level dependency inversion. Enforced by `boundary-check.test.ts`. New files added
to `viewer/messaging/` inherit this exemption — review them to ensure they are genuine
messaging infrastructure, not general viewer code.

## UI composition governance

The viewer's UI composition layer — the shell (top-nav, stage-links, bottom-bar,
settings-overlay, commands-sheet) plus config-footer, faq, logos and theme-toggle — is a
composition root: it imports broadly from `web-viewer` while its internal files serve
distinct UI concerns. Louvain currently reports this as `web-composition-layer` (4 files,
cohesion 0.65 / coupling 0.35); earlier revisions called it `viewer-ui-hub` with
different metrics. Low cohesion here is **structurally expected** and not by itself a
defect.

- **No domain logic:** this layer holds UI composition components and their direct
  rendering helpers only. Data fetching and state management belong in hooks or views.
- **Monitor fan-out:** its coupling with the dashboard platform zone is the largest
  cross-zone relationship in the web package — audit import direction periodically so
  inbound imports enter through `api.ts` or composition-root wiring rather than ad-hoc
  leaf reach-ins.

## Reaching the server's addressing helpers

Never hand-build a URL. `installBasePathFetch()` prefixes root-relative `fetch`,
`getWebSocketUrl()` is the one socket endpoint, and `appUrl()` covers history entries,
share links and the logo. All three derive the hub prefix and the `/w/<key>` workspace
slot from `location.pathname` at boot (`viewer/base-path.ts`), over the same
`src/shared/base-path.ts` the server uses, so where the prefix ends is defined once.

**Sockets open through `openWebSocket()`** (`viewer/session.ts`), never
`new WebSocket(...)`: on a token-protected server the handshake needs a
single-use ticket (`socket-guard.test.ts`). A link to a server-generated
document uses `credentialedLinkClick`, since a navigation carries no credential
([why](../../../../docs/architecture/web-server.md#authentication)).

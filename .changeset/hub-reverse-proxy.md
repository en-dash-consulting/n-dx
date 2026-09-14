---
"@n-dx/web": minor
---

Hub reverse proxy under `/p/:id/`, viewer base-path support, and the sole-project root alias (0.7.0 / PR 8).

The hub now proxies every request under `/p/:id/*` to that project's child server — prefix stripped, query preserved, bodies streamed, WebSocket upgrades piped raw (plain node:http, no new dependency). A bare `/p/:id` redirects (308) into the slashed form so the viewer's relative assets resolve. With exactly one project registered, the root surface (`/`, `/api/*`, `/data/*`, `/mcp/*`, WebSocket) aliases to it transparently; with zero or several, root API paths answer 409 naming the registered project ids and `/` serves a placeholder home page listing `/p/<id>/` links (replaced by PR 9).

The hub is now the browser-facing edge: it enforces the same origin/CORS policy as the child (`src/hub/edge-security.ts`, kept in lockstep with `server/request-security.ts`) and then strips browser-origin metadata before forwarding — the child validates Origin against its own port, which through a proxy would always mismatch.

The viewer works under a base path derived from `location.pathname` at boot (`/p/<id>` behind the hub, `""` served directly — in which case nothing changes, including the untouched native `fetch`). One global fetch adapter prefixes the ~160 root-absolute `fetch("/api/…")`/`fetch("/data/…")` calls, `getWsUrl()` routes all 12 WebSocket connections through the prefix, and `history.pushState`/`replaceState` URLs plus copied share-links carry it. Route parsing strips the prefix uniformly, so deep links like `/p/<id>/prd/<task>` resolve. New pure helpers live in `src/shared/base-path.ts`.

---
"@n-dx/web": minor
---

Hub reverse proxy and viewer base-path support. Requests under `/p/<id>/…` are proxied to that project's server with the prefix stripped — HTTP streamed both ways, WebSocket upgrades piped through — and root-relative redirects are re-prefixed. With exactly one project registered the root (`/`, `/api/*`, `/data/*`, `/mcp/*`, the socket) aliases to it unchanged; with several, `/` lists the projects and other root requests answer 409 with their ids. The viewer derives its base path from `location.pathname` at boot, prefixes every root-relative `fetch` through one adapter, connects its sockets through one URL helper, and writes prefixed history entries, so every view and deep link works at `/p/<id>/<view>` while `web serve` at `/` is unchanged.

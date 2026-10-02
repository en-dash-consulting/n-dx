---
"@n-dx/web": patch
---

Require a per-user token on the hub, dashboard and preview servers when started with `--token-file`. The token is created in the file if absent (mode 0600) and every request and WebSocket handshake must present it as `Authorization: Bearer`, `X-Ndx-Token`, or the `ndx_token` cookie; a safe-method navigation carrying `?ndx_token=` sets the cookie and redirects to the clean URL. The hub passes the file to the project servers it spawns and sends the token on its own probes, and the proxy forwards the browser's cookie. A server started without `--token-file` behaves as before.

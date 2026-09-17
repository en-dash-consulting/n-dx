---
"@n-dx/web": patch
---

Reject cross-origin WebSocket upgrades on the dashboard server.

A WebSocket handshake carries no CORS preflight, so the HTTP-side
`handleRequestSecurity` guard never saw it — the `upgrade` handler checked only
for a `Sec-WebSocket-Key`. While `ndx start` ran, any page open in the user's
browser could `new WebSocket("ws://localhost:<port>")` and receive every
broadcast: PRD changes, `hench:task-execution-progress` (which carries the
agent's last stdout line), execution and memory state. Inbound frames are
limited to close/ping/pong, so this was a passive read, but the only
cross-origin hole in an otherwise well-guarded server.

`handleUpgrade` now applies the same origin check the HTTP guard uses
(`isTrustedBrowserOrigin`, exported for this): a present `Origin` must be this
loopback server's own (compared against the socket's local port, so a
DNS-rebinding Host cannot match), or the upgrade is answered `403 Forbidden`
and the socket destroyed before any client is registered. A missing `Origin`
(non-browser CLI/MCP clients) stays allowed, matching the HTTP guard's contract.

Found by the 2026-09-11 adversarial security review (finding E).

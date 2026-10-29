---
"@n-dx/web": patch
---

The dashboard, hub and preview servers no longer set or accept an `ndx_token` cookie. A browser signs in by exchanging a single-use, 60-second nonce from the URL `ndx start` prints for a session credential of its own, kept in `sessionStorage` and sent as `X-Ndx-Token`; WebSocket handshakes carry a single-use ticket from `POST /api/auth/ws-ticket`. Sessions live in the memory of the server that minted them and end on restart. A navigation without a credential gets the page shell, which shows how to sign in; other tabs of the same origin hand a new tab their session. The per-user token in headers is unchanged for the CLI and MCP clients.

---
"@n-dx/core": patch
"@n-dx/web": patch
"@n-dx/graview": patch
---

Printed and opened dashboard URLs, MCP registration lines, `NDX_HUB_URL` and graview's hub endpoint now use `http://127.0.0.1:<port>` instead of `http://localhost:<port>`. The hub and project servers bind only `127.0.0.1`, and `localhost` may resolve to `[::1]` first, where another local account could listen on the same port and receive the sign-in nonce or the token. Re-register HTTP MCP clients with the `127.0.0.1` URL.

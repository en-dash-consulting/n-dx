---
"@n-dx/web": patch
---

The hub removes `ndx_token` from the query string of every request it forwards to an extension sidecar, including POSTs and WebSocket upgrades, so a sidecar never sees the credential. Every other query parameter reaches the sidecar exactly as the client sent it.

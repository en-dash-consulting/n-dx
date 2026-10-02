---
"@n-dx/web": patch
---

Validate the `Host` header on every hub, dashboard and preview request. A WebSocket upgrade whose `Host` does not name the hub is answered `421 Misdirected Request`, matching the HTTP path and the project server's own upgrade handler, rather than `403 Forbidden`.

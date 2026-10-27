---
"@n-dx/web": patch
---

A request or WebSocket to `/x/<name>/` whose client disconnects while the sidecar is starting is no longer counted or forwarded, so the sidecar still stops when idle.

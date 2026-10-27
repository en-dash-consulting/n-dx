---
"@n-dx/web": patch
---

A connection to a stopped or crashed sidecar that closes after its replacement starts no longer lowers the replacement's request or WebSocket count, so the hub no longer idle-stops a sidecar that still has an open WebSocket.

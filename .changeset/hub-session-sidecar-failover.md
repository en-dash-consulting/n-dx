---
"@n-dx/web": patch
---

A hub session request, or WebSocket upgrade, that a host refuses for
`web.sidecar` is retried on the next healthy host instead of answering the
client 403. The body is buffered up to 1 MiB so it can be replayed; a larger
one is refused with 413.

---
"@n-dx/web": patch
---

An over-cap chunked request body now gets an HTTP 413 instead of a reset connection. `readBody` used to destroy the request the moment the streamed cap was passed and leave the answering to the caller's `catch` — which could not work, because destroying the request destroys the socket, so the 400 was written into a closed connection and the client received zero bytes and an EPIPE. It now sends the same 413 the Content-Length guard sends, closes cleanly, and still rejects so callers keep their existing `catch` (which no-ops once the response is committed). Only clients that send chunked bodies without a Content-Length were affected; the dashboard always sends one.

---
"@n-dx/web": patch
---

Cap request body size on the dashboard server.

`readBody` concatenated every chunk with no limit, so a local process (the
server is loopback-only) could POST a multi-gigabyte body to any route and
drive it out of memory before the handler ran.

A new `MAX_REQUEST_BODY_BYTES` (10 MB — the largest legitimate body is a PRD
bundle import) is enforced in two places: `handleRequestSecurity`, which runs
first for every request, answers `413` and destroys the connection when the
declared `Content-Length` exceeds the cap (before any buffering); and
`readBody`, which stops buffering, destroys the request, and rejects if a
chunked body with no declared length streams past the cap. `jsonResponse` is
now a no-op once the response is committed, so a route that already answered
cannot double-write.

Found by the 2026-09-11 adversarial security review (finding H).

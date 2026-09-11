---
"@n-dx/web": patch
---

Resolve a requested port of 0 to a real ephemeral port instead of returning the literal 0.

`findAvailablePort(0)` probed port 0 through `checkPort`, whose result is
platform-dependent: on Linux the connect probe fails `ECONNREFUSED`, the bind
phase then succeeds (binding 0 always does), and the literal 0 came back as
the allocated port — `startServer` then logged it, wrote it to the port file,
and returned it to callers as a port no client can connect to. Windows masked
the bug by failing the connect probe with `EADDRNOTAVAIL` and falling through
to the ephemeral allocator, which is why the scoped-route-dispatch integration
test passed on Windows and died at boot on Linux CI. Port 0 now takes the
ephemeral allocator directly on every platform, which also skips the pointless
retry backoff Windows paid while probing it.

Also stops the server calling that resolution a fallback. `PortAllocationResult`
gains `isFallback` — the request could not be honoured, so a different port was
substituted — which is deliberately not the inverse of `isOriginal`. For port 0
the bound port is not the number asked for (`isOriginal: false`) but the request
was satisfied exactly, so nothing fell back. Both consumers read `!isOriginal`
and were wrong: the operator saw `Port 0 is in use — using port 54321 instead.`
about a port that was never in use, and `StartResult.isFallback` told a caller
that had asked for an ephemeral port it got a fallback. Both now read
`isFallback`, so a third consumer is correct by default. `isOriginal` keeps its
documented meaning and its value in every case.

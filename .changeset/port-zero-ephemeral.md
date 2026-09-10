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

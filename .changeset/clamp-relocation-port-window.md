---
"@n-dx/core": patch
---

fix(core): clamp findRelocationPort's near window to port 65535

`findRelocationPort` scanned `requestedPort + 1` through
`requestedPort + 83` without clamping to the maximum TCP port. For a
requested port near the top of the range (e.g. `--port=65535` or
`--port=65500`), the scan reached 65536 and beyond;
`net.createConnection` throws `ERR_SOCKET_BAD_PORT` synchronously for a
port outside 0–65535, which crashed `ndx start`'s relocation branch
instead of relocating or falling back to 3117–3200.

The near window's upper bound is now clamped to 65535. `isPortInUse` is
also defensive: an out-of-range port is treated as "in use" rather than
probed, so no future caller can reintroduce the same crash.

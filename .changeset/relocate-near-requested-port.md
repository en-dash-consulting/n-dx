---
"@n-dx/core": patch
---

fix(core): relocate near the requested port, not into 3117–3200

`runWeb`'s peer-relocation branch called `findFreePortInRange(port)`, whose
defaults scan 3117–3200 regardless of what `port` actually was — the
requested port was used only as the value to skip. An operator who set
`web.port` or passed `--port` to steer around an environment that blocks
3117 (corporate proxy, another service) had that instruction silently
overridden: their second project relocated straight back into 3117–3200,
typically landing on 3117 itself.

`findRelocationPort` now scans upward from the requested port first
(`port + 1` through `port + 83`, the same width as the default range) and
falls back to 3117–3200 only when that neighbourhood is full. For the
default port (3117) the near window already covers 3118–3200 exactly, so
behaviour there is unchanged.

`tests/e2e/cli-start-two-projects.test.js` and
`tests/unit/web-port-occupant.test.js` are updated to assert the new
contract; the latter adds direct coverage of `findRelocationPort`'s window
selection for a port outside the default range, the default port itself, and
the fallback path.

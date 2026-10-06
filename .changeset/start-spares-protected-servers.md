---
"@n-dx/core": patch
---

`ndx start` no longer SIGKILLs a token-protected n-dx server on the requested port; it moves to the next free port, as it already did for the hub and peer dashboards. `ndx start --background` now waits until the server is listening (up to 30s, or until the server exits) instead of giving up after 5s and printing a URL that refused connections.

---
"@n-dx/web": patch
"@n-dx/core": patch
---

With auth on, the hub now presents the per-user token on every call it makes to a project server. Its queued-run replay and `POST /api/hench/execute/check` pre-check used to get 401 (a queued run was dropped as "could not start", the pre-check failed open), and the in-flight count behind the machine-wide session cap read 0, so the cap never held. `ndx refresh --live-server`'s reload request sends the token too.

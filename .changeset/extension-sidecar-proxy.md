---
"@n-dx/core": patch
"@n-dx/web": patch
---

The hub's `/x/<name>/` proxy now keeps the per-user token away from extension sidecars: the `X-Ndx-Token` header, the `ndx_token` cookie and a bearer carrying the token are removed from forwarded HTTP and WebSocket requests, and `X-Ndx-Base-Path: /x/<name>/` is added. The bare `/x/<name>` redirects to `/x/<name>/`. A disabled or unapproved extension answers 404 with the reason, as an unknown one does. `x` is reserved as a project id: the hub refuses to register it, and a repository named `x` gets a hashed id.

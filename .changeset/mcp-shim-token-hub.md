---
"@n-dx/core": patch
---

`ndx mcp <server>` bridges to a hub that requires the per-user token again: the shim identifies the listener as this user's hub, then checks health with the token, instead of reading the hub's anonymous 401 as "no hub" and always serving in-process.

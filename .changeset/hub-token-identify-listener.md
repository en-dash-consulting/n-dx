---
"@n-dx/core": patch
---

`ndx start`, `ndx start status`, `ndx start stop`, `ndx refresh`'s live reload and the MCP shim now send the per-user token only to a listener identified as this user's own n-dx hub or dashboard (recorded pid, alive, owned by this user, sole listener on the port). A port held by anything else is reported and gets no credentialed request.

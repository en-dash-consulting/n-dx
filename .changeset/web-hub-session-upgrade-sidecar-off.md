---
"@n-dx/web": patch
---

A project server with web.sidecar off now answers a WebSocket upgrade to a hub session path (`/api/sidecar/hub/…`) with 403 and `x-ndx-feature-disabled: web.sidecar`, as its HTTP routes already did, so the hub moves the drawer's socket to a host that has the feature on. Other upgrade paths are unchanged.

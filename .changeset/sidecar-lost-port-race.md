---
"@n-dx/web": patch
---

The hub no longer marks a sidecar running when it exits right after its health check passed, as one does when another server took its port first and answered for it.

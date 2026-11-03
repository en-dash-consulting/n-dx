---
"@n-dx/web": patch
---

The hub session drawer page is 88 KB instead of 545 KB: it imports the Sidecar
hooks and drawer through a narrow barrel, so it no longer bundles zod, the
loader or the dashboard's top nav.

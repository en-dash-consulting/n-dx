---
"@n-dx/core": patch
---

Retry a transient Windows EPERM, EACCES or EBUSY when reading `extensions.json` while another `ndx` process replaces it, as the rename already does, so concurrent approvals and discovery no longer fail.

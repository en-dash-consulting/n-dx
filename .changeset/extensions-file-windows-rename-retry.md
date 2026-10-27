---
"@n-dx/core": patch
---

Writes to `extensions.json` retry a rename Windows refuses with EPERM, EACCES or EBUSY while another `ndx` process has the file open, so concurrent `ndx extensions list` runs and approval, disable or removal writes no longer fail. A failed write removes its temp file, and temp files left by processes that are gone are swept.

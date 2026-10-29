---
"@n-dx/web": patch
---

Sidecar settings now refuse a never-allow-listed command (work, reset, push) when it is added, using `POST /api/sidecar/allow-list?dryRun=1`. Save checks every staged command before writing anything, and after a failed Save the allow-list shown is re-read from the broker's file.

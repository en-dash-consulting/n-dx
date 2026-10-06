---
"@n-dx/hench": patch
"@n-dx/web": patch
---

`ndx work --resolve` applies repository trust like a run: on an untrusted repository it reports `bypassPermissions` lowered to `acceptEdits` (source `repository-trust`) with a non-blocking `untrusted-repository` warning, and the Prepare task modal's preflight shows it.

---
"@n-dx/rex": patch
---

On Windows, PRD store writes retry a rename that fails because another process briefly has the target open (EPERM, EACCES or EBUSY), instead of failing the command. The temp file is removed if the rename still fails.

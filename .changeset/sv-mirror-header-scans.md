---
"@n-dx/sourcevision": patch
---

`ndx analyze` finds mirrored folders and reads third-party headers faster on large repositories.

Mirror detection indexes the inventory once instead of rescanning it for each candidate folder pair, and file headers are read 16 at a time instead of one by one. Results are unchanged.

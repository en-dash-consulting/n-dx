---
"@n-dx/sourcevision": patch
---

`sv pack bundle` no longer follows symbolic links in the installed prefix: it leaves each one out and names it, so a link loop cannot hang it and a link out of the tree cannot copy files from elsewhere into the bundle.

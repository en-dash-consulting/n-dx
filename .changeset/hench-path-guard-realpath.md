---
"@n-dx/hench": patch
---

The hench path guard resolves symbolic links before deciding whether a path lies inside the project and before matching blocked patterns, and returns the real path so the file, search and shell tools operate on the location that was checked. A path that does not exist yet is checked at the location its nearest existing ancestor resolves to.

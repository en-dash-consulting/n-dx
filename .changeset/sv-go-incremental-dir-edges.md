---
"@n-dx/sourcevision": patch
---

Incremental import analysis keeps Go edges again. The #744 carry-over guard
accepted only edge targets that are inventoried files, but Go edges point at
the imported package's directory, so an incremental analyze dropped every
unchanged Go file's internal edges. A target may now be an inventoried file or
a directory holding one; edges to a directory whose files are no longer
inventoried are still dropped.

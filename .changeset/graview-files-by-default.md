---
"@n-dx/graview": patch
"@n-dx/graview-face": patch
"@n-dx/core": patch
---

`ndx graview emit` projects every source file by default (`--no-files` or `graview.includeFiles: false` leaves them out), and ties each one to the work: a commit to the files it changed (`changed`) and a capability to the files its realizing commits changed (`livesIn`), from the same commit-file read that already placed capabilities in zones. A capability's page lists the files it lives in, and a file's page lists its zone, the capabilities living there and the commits that changed it.

---
"@n-dx/core": patch
---

`ndx start` (and `ndx web`) now print how to stop the server as the last line
of the success block: `Stop: ndx start stop .   (or 'ndx hub stop' for every
project)`. Previously the server ran through the hub daemon and returned
immediately with no indication that Ctrl-C does nothing — the stop commands
existed but were documented only under `--help`, which is read before the
command, not after.

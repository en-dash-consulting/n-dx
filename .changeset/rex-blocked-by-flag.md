---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`rex add` and `rex update` accept `--blocked-by=<id,…>`, alongside the existing `--blockedBy`. The flag takes a comma-separated list and can be repeated, and `rex update <id> --blocked-by=` clears the list. Both commands' `--help` now list it. `ndx add --help` also documents manual mode (`--title`, `--parent`, `--criterion`, `--blocked-by`), which adds an item without the smart-add model call.

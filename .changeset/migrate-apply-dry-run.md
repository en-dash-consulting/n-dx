---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate --apply [--plan <path>] [--dry-run] [dir]` spawns `rex migrate --apply` and forwards its exit code. `--dry-run` runs apply up to the write, with the same refusals, and prints per v1 kind how many items become each v2 type, how many are held for the Inbox and how many metadata values are dropped (`droppedMeta`, `droppedLog`); it writes nothing.

---
"@n-dx/hench": patch
---

`ndx work --dry-run --fresh` no longer deletes the cached orientation session. A dry run now prints "Would discard the cached orientation session" and leaves the cache alone, so the dashboard's brief preview with Session: Fresh ticked costs the next real run nothing. A real run with `--fresh` still clears it.

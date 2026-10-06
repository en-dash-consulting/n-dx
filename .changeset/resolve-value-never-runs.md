---
"@n-dx/core": patch
"@n-dx/hench": patch
---

`ndx work --resolve=<value>` now resolves instead of starting a real run. Any value except `false` (which means no flag) resolves, in both core and hench.

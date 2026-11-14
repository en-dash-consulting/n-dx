---
"@n-dx/core": patch
---

`ndx config hench.testGate.maxWorkers` refuses any value that is not a whole number of at least 1, such as `0`, `-1`, `2.5` or `abc`.

Hench's own config schema rejects those values, so saving one would stop `hench config` and `hench record` from loading the file and make `ndx work` drop the whole `testGate` block.

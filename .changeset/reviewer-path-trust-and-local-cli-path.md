---
"@n-dx/core": patch
---

The cross-vendor reviewer path now respects repository trust: in an untrusted
checkout the repository's `hench.guard.env.allow` entries are ignored (with a
one-time warning) until `ndx trust accept .`. It also reads `llm.<vendor>.cli_path`
from `.n-dx.local.json` before `.n-dx.json`, where `cli_path` is actually written.

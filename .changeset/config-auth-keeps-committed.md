---
"@n-dx/core": patch
---

`ndx config llm.<vendor>.auth <mode>` writes `.n-dx.local.json` and no longer removes an auth the repository commits in `.n-dx.json`; the local value overrides it.

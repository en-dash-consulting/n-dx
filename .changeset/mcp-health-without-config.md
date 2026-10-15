---
"@n-dx/rex": patch
---

MCP `health` on a v2 tree with no `.rex/config.json` returns its score and the v2 report on default thresholds instead of an ENOENT error. `rex health` is unchanged.

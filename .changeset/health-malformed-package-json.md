---
"@n-dx/rex": patch
---

`rex health` and the MCP `health` tool on a v2 tree no longer fail when `package.json` is not valid JSON; the title release-token rule skips and the rest of the report is returned.

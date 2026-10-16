---
"@n-dx/rex": patch
---

The rex MCP `get_capabilities` tool now reports `"schemaVersion": "rex/v2"` on a
v2 tree. It answered `"rex/v1"` beside `"adapter": "v2-change-layer"`, so a
client that reads `schemaVersion` took the tree for v1. A v1 tree still reports
`rex/v1`. The change layer store declares its version through the new optional
`schemaVersion` on `StoreCapabilities`.

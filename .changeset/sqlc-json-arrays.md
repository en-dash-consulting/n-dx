---
"@n-dx/sourcevision": patch
---

Migration-tool detection parses `sqlc.json` as JSON, so `schema` and `queries` arrays in either version's `sql`/`packages` entries yield every path. YAML configs also read a flow list followed by a comma or spread over several lines.

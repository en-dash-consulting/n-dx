---
"@n-dx/rex": patch
---

On a v2 tree, the MCP `health` tool adds a `v2` field to its response: the tree rules, reader warnings and landing check that `rex health` shows, so an agent and a person see the same health for the same tree. Every existing field is unchanged, and v1 responses are identical.

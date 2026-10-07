---
"@n-dx/rex": patch
---

Split the rex MCP tool handlers into one module per tool behind a registry.

`cli/mcp-tools.ts` held all nineteen tools in one 1,083-line file and `mcp.ts`
held their names, descriptions and input schemas inline, so every MCP change
touched both. Each tool now owns its name, description, schema, access kind and
handler in `cli/mcp-tools/<tool>.ts`; `registry.ts` lists them in registration
order and `mcp.ts` registers whatever it lists.

Behaviour-neutral: the `tools/list` response is byte-for-byte identical, and a
snapshot generated from the pre-split server is checked into
`tests/unit/cli/mcp-tools-list-snapshot.test.ts` as the evidence.

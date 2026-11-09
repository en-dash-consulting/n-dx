---
"@n-dx/llm-client": patch
---

Codex `mcp_tool_call` items now parse into a tool use named `mcp__<server>__<tool>` and a tool result whose error flag comes from the item's status, so Codex broker calls show in the Sidecar transcript.

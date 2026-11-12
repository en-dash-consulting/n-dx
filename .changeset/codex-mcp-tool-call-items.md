---
"@n-dx/llm-client": patch
---

Codex broker calls now appear in the Sidecar transcript.

Codex `mcp_tool_call` items parse into a tool use named `mcp__<server>__<tool>` and a tool result whose error flag comes from the item's status.

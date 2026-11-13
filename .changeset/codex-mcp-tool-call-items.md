---
"@n-dx/llm-client": patch
---

(experimental, off by default; enable with `web.sidecar`) Codex broker calls appear in the Sidecar transcript.

Codex `mcp_tool_call` items parse into a tool use named `mcp__<server>__<tool>` and a tool result whose error flag comes from the item's status.

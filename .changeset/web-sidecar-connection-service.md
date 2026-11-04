---
"@n-dx/web": patch
---

Connection service for the Sidecar: n-dx connects to MCP servers the operator declares under `connections` in `.n-dx.local.json` (streamable HTTP or stdio; auth none or a token stored as `connection:<id>`) and lists their tools as `<id>.<tool>`. A `connections` block in the tracked `.n-dx.json` is ignored with a warning. Nothing uses it yet; the broker wiring follows.

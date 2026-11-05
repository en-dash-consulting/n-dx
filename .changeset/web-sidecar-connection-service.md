---
"@n-dx/web": patch
---

Connection service for the Sidecar: n-dx connects to MCP servers the operator declares under `connections` in `.n-dx.local.json` (streamable HTTP or stdio; auth none, a token stored as `connection:<id>`, or an OAuth sign-in) and lists their tools as `<id>.<tool>`. A `connections` block in the tracked `.n-dx.json` is ignored with a warning.

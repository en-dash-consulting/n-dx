---
"@n-dx/web": patch
---

Settings > Project > Connections manages the Sidecar's MCP servers while `web.sidecar` is on: add an HTTP or stdio server with auth none, a token or OAuth, test it, remove it, change each discovered tool's class and policy, pick a server profile and see its validation, and set each tracker sync rule to off, dry-run or on. Writes go only to `.n-dx.local.json`; a typed token goes straight into the credential store and is never returned.

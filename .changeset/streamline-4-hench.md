---
"@n-dx/hench": patch
---

Internal: refactor hench without changing behaviour: the three API loops share their scaffolding, the pre-run commit gate moves out of shared.ts, and run-record caps and local endpoint defaults are named once.

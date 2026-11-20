---
"@n-dx/web": patch
---

Internal: the job tray takes the `web.sidecar` toggle from `main.ts` instead of reading it itself, so `use-feature-toggle` stays inside its zone.

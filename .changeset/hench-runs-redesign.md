---
"@n-dx/web": patch
---

Redesign the Hench Runs view so the run history is the focus. The four
operational diagnostic panels (concurrency, memory, WebSocket health, throttle)
that previously stacked above the run list now live in a collapsed "System
status" drawer at the bottom, and the WebSocket health panel — previously
rendered with no CSS — is now styled to match the other panels.

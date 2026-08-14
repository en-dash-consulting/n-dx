---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Self-heal can be stopped from the dashboard. `exec` in the foundation client accepts an `AbortSignal`, and the web server exposes `POST /api/commands/self-heal/stop`, which cancels the running loop and reports it as stopped rather than failed. The Self-Heal panel shows the current iteration and phase parsed from loop output, with a Stop button while it runs.

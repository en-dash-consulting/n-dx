---
"@n-dx/web": patch
---

Robot Wrangler now offers each vendor only the providers hench accepts and replaces free-text model entry with dropdowns over the server's model catalog. An agent model picker saves `hench.models.<vendor>` (with "Use project default" and free entry), and the project and light model fields use the same list. The page shows where the list came from with a Refresh action, and the installed CLI version for Claude and Codex. `PUT /api/llm/config` accepts `hench.models.<vendor>` and now rejects an `llm.<vendor>.model` or `lightModel` the vendor cannot run. The hard-coded `MODEL_SUGGESTIONS` list is gone.

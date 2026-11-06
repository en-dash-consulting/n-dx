---
"@n-dx/web": patch
---

The credential-check cache is keyed by the effective vendor and its `llm.<vendor>` settings, so a config change made outside the dashboard no longer serves the previous vendor's verdict.

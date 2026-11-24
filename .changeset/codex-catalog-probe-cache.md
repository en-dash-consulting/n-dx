---
"@n-dx/web": patch
---

The dashboard's Codex model picker keeps freshly offered models valid for task saves and launches while concurrent lookups share one probe.

Successful probes last up to one minute, failures up to ten seconds, and refresh bypasses both. Effective configuration, auth-file, binary, environment and trust changes invalidate cached results. Failed validation now includes the catalog's recovery advice.

---
"@n-dx/web": patch
---

Opening Tune no longer runs the vendor CLI. The Your tooling tile renders straight from config and the catalog, and reads only a cached credential verdict from the new `GET /api/commands/auth/cached`. The live check stays on Robot Wrangler's Re-check.

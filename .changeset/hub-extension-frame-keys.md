---
"@n-dx/web": patch
---

The hub issues frame keys for extension drawer tabs (`POST /api/hub/extensions/:name/frame`) and serves `/x/<name>/~f/<key>/` with a sandboxing Content-Security-Policy and no Referer; a key works only on its own extension's paths and is dropped on disable, removal or hub restart.

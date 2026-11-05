---
"@n-dx/web": patch
---

A drawer tab's scripts can read their own sidecar: on a frame-keyed request with `Origin: null` the hub adds `Access-Control-Allow-Origin: null` and `Vary: Origin` (never credentials) and answers the preflight itself, so an extension needs no CORS code to work in a tab.

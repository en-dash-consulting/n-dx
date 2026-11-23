---
"@n-dx/lang-runtime": patch
"@n-dx/lang-kit": patch
---

Internal: a framework pack's context now carries `configFiles`, the configuration text its pack's resolver read beside the sources, and `RouteFact` gains an optional `source` naming where a route was declared outside its handler's code.

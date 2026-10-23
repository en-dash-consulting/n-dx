---
"@n-dx/web": patch
---

`PUT /api/llm/config` and `POST /api/llm/config/preview` refuse a path with a `__proto__`, `constructor` or `prototype` segment. A delete of `llm.tiers.__proto__.toString` (a `null` or `""` value) skipped the tier shape check, walked through `config.llm.tiers["__proto__"]` — Object.prototype — and removed `toString` from the dashboard process; `llm.routes.__proto__` answered 200 for a write that did nothing. A delete is now held to the `llm.tiers.<vendor>.<tier>` shape like a set, and the nested set and delete helpers refuse those segments on their own as well. The features route writes through the same guarded helper the hench and adaptive routes use, and the workflow suggestion allowlist checks own keys only, so a body keyed `toString` no longer reaches `.hench/config.json`.

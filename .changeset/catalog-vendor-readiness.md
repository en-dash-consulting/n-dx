---
"@n-dx/web": patch
---

`GET /api/llm/catalog` reports each vendor's `readiness` (`ready`, `needs-setup`
or `unreachable`, with a one-line summary) for the provider it would run on.
API-key presence is reported as a boolean; the key itself is never returned.

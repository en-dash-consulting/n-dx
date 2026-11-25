---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

`hench.language: "php"` is now accepted by `hench config`, the dashboard's settings and the repository trust review.

The trust review used to discard a tracked `php` value instead of reviewing it. hench's language list is now the one source for its schema, `hench config` and `hench init`; tests hold the trust review and the dashboard field to it.

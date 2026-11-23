---
"@n-dx/lang-php": patch
---

PHP outbound calls no longer report request values read with `getenv` (such as `HTTPS`, `REQUEST_URI` or `SSL_SESSION_ID`) as environment dependencies. A mysqli host built as `'p:' . $server` is now reported as unknown instead of the literal `p:`, and a persistent `p:db.internal` host is reported as `db.internal`.

---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer reports a fragment of a host, such as `db-` or `http`, as an outbound call's literal target.

A DSN, connection string or URL whose literal text ends inside the scheme or the host is now reported as `unknown`, with the expression as written. Examples are `'mysql:host=db-' . $env . '.internal'`, `"mysql:host=db{$n}.internal"`, `'host=pg-' . $region` and `'http' . ($s ? 's' : '') . '://x'`. Hosts written in full and hosts resolved from a constant or config value are reported as before.

---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer reports a fragment of a host, such as `db-` or `http`, as an outbound call's literal target.

A DSN, connection string or URL whose literal text ends inside the scheme or the host is now reported as `unknown`, with the expression as written. Examples are `'mysql:host=db-' . $env . '.internal'`, `"mysql:host=db{$n}.internal"`, `'host=pg-' . $region` and `'http' . ($s ? 's' : '') . '://x'`. A connection string kept as written has its password values replaced with `REDACTED`. `file_get_contents`, `fopen`, `file` and `get_headers` on such an `http://` or `https://` URL are still reported. Hosts written in full and hosts resolved from a constant or config value are reported as before.

---
"@n-dx/sourcevision": patch
---

`sv analyze` no longer writes a credential found in source to `.sourcevision/`: URLs lose their `user:password@`, and secret query and connection-string values become `REDACTED`.

Every JSON artifact, `CONTEXT.md`, `llms.txt` and each zone's `context.md` go through one redaction, for every language. Before this, `outbound.json` wrote an HTTP target such as `curl_init('https://u:pw@host/v1')` whole, password included. Scheme, host, port, path and other parameters are kept. Secret-shaped names are `password`, `pwd`, `pass`, `secret`, `token`, `api_key`, `access_key`, `auth`, `key`, `sig`, `signature` and `credentials`, in any case, with `_`/`-` variants.

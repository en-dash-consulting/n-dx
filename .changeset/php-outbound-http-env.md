---
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `outbound.json` now lists the web services and environment variables PHP code depends on.

HTTP calls come from `curl_init` and `curl_setopt(…, CURLOPT_URL, …)`, `file_get_contents`, `fopen`, `file` and `get_headers` on an `http://` or `https://` URL, `fsockopen`, `new SoapClient`, and Guzzle clients and their request methods. Environment reads come from `getenv`, `$_ENV` and `$_SERVER`; request keys such as `HTTP_HOST`, `REQUEST_URI` or `SERVER_NAME` are not counted as environment variables. A target is the URL when the code spells it out (literals, constants and variables included), the variable name for an environment read, the key for a `$config['…']` value, and empty otherwise. Without the PHP pack, `outbound.json` is unchanged.

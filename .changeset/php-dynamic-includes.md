---
"@n-dx/lang-php": patch
---

With the PHP pack, analyze now reports the includes whose path is built at run time, naming each file and line instead of guessing a target. Includes that pick a file by the request's host name (`$_SERVER['HTTP_HOST']`, `$_SERVER['SERVER_NAME']`), the usual way multi-tenant sites load a tenant's configuration, are reported separately, also when the host name reaches the path through a variable (`$host = $_SERVER['HTTP_HOST']; include "config/$host.php";`). When the path starts or ends with fixed text (`'modules/' . $name . '/index.php'`), the pack lists up to 50 files it could load. These files are never import edges, so zones do not change.

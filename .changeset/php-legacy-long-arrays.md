---
"@n-dx/lang-php": patch
---

With the PHP pack, `sv analyze` counts uses of `$HTTP_*_VARS`, `$HTTP_POST_FILES` and `$HTTP_RAW_POST_DATA` as legacy constructs.

The long arrays `$HTTP_GET_VARS`, `$HTTP_POST_VARS`, `$HTTP_COOKIE_VARS`, `$HTTP_SERVER_VARS`, `$HTTP_ENV_VARS`, `$HTTP_SESSION_VARS` and `$HTTP_POST_FILES` are deprecated in 5.3 and removed in 5.4; `$HTTP_RAW_POST_DATA` is deprecated in 5.6 and removed in 7.0, each with its php.net page. Every read or write counts, in a `global` statement, string or heredoc too. A property, static property, parameter or array key with the same name does not.

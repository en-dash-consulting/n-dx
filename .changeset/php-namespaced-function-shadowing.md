---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer drops removed-function and dynamic-code findings when a namespaced helper shares a built-in's name.

Function calls now resolve as PHP resolves them: an unqualified call goes to a `use function` import, then to the current namespace's function when the repository declares one, then to the global function; `\name()` goes to the global function only. A finding is skipped only when the call reaches a function the repository declares. Before, `namespace Helpers; function mysql_query() {}` in one file hid an explicit `\mysql_query()` in another, and a helper named `call_user_func` hid `\call_user_func($handler)` and its database provenance. A global polyfill (`function each()` outside any namespace) still takes every call that reaches it. A `use function mysql_query as query;` import of PHP's own function is now reported at `query()`.

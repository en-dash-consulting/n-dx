---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer marks `call_user_func(($x)->handler)` as database-driven when only a sibling property of `$x` comes from a query.

Parentheses around a variable, as in `($x)->handler` or a copy made with `$y = ($x)`, now keep each property's own sources, as they already did without parentheses.

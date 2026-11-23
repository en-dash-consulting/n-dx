---
"@n-dx/lang-runtime": patch
---

Internal: a call written with a space or comment before its argument list, such as PHP's `foo ($x)` or `$db->query ($sql)`, keeps its callee and receiver in a pack's call facts.

The name is the one the call holds directly, outside any inner call, that ends last before the list opens; a call whose callee is not a name, such as `foo() ($x)`, still has none.

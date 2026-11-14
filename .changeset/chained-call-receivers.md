---
"@n-dx/lang-runtime": patch
---

Internal: in a chain of calls such as `$a->b()->c()`, each call's receiver in a pack's call facts is the expression directly before its name, whatever order the query captures it in.

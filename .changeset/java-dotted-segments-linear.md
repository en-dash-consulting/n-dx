---
"@n-dx/lang-java": patch
---

The Java resolver no longer takes quadratic time reading a dotted name with many unterminated `/*` or deeply nested generics. Results are unchanged.

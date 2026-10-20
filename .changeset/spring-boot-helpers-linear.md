---
"@n-dx/lang-java": patch
---

The Spring Boot rules no longer take quadratic time on a type name with many `<` and no `>`, or on a mapping prefix with a long run of `/` followed by another character. Results are unchanged.

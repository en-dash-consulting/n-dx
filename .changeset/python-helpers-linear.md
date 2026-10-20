---
"@n-dx/lang-python": patch
---

The Python outbound-call and route rules no longer take quadratic time on a name followed by a long run of spaces in an env lookup, or on a route prefix with a long run of `/` followed by another character. Results are unchanged.

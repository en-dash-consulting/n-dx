---
"@n-dx/lang-python": patch
---

The Python outbound-call rules follow Python's scoping when they decide a receiver is a client: a parameter or any other binding of a module-level client's name inside a function makes the call's receiver unknown rather than `certain`, `global` and `nonlocal` are honoured, lambdas and comprehensions are scopes, and a client bound in an enclosing function is now seen by the functions nested in it.

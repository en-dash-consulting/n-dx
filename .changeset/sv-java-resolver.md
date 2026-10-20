---
"@n-dx/sourcevision": patch
---

Add the internal Java reference resolver. It resolves single-type, wildcard, static and nested-type imports, plus same-package references that need no import, to the files that declare them, in Java's lookup order. References to packages outside the project are recorded as external, by package. The pack resolver contract now indexes the whole project once through `prepare`.

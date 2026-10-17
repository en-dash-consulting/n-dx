---
"@n-dx/lang-java": patch
---

The Java resolver no longer links a test file to another module's test code. A test in `svc-a` that names a class declared only in `svc-b/src/test` gets no edge to it, and a name declared in `svc-b/src/test` and `svc-c/src/main` resolves to the main declaration alone, so test zones no longer merge across services that share package names. Test-jar and `testFixtures` dependencies are not read, so their cross-module edges are dropped too.

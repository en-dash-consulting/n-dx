---
"@n-dx/lang-java": patch
"@n-dx/lang-kit": patch
---

The Java resolver links a test file to another module's test code only when the build lets javac do so: a Maven dependency of type `test-jar` or classifier `tests` on that module, a Gradle `testFixtures(project(':x'))` (its `testFixtures` set) or a project dependency on a test configuration such as `testArtifacts` (its `test` set). Otherwise a test in `svc-a` that names a class declared only in `svc-b/src/test` gets no edge to it, and a name declared in `svc-b/src/test` and `svc-c/src/main` resolves to the main declaration alone. Main code never links to test code. lang-kit's Gradle build model gains `projects`, the module's dependencies on other projects of the build.

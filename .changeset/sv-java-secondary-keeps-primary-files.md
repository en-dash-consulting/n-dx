---
"@n-dx/sourcevision": patch
---

A `pom.xml` or Gradle build beside another language's marker no longer hides that language's files. Java as a secondary language skips only `target/` and `.gradle/` and flags nothing as generated, so TS, Python and Go files under `out/`, `build/` or `generated/` keep their inventory entries and import edges. Java-primary repositories are unchanged.

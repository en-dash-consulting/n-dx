---
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
---

Java's `target/`, `build/`, `out/` and `generated/` are skipped only as build output: at the project root or beside `pom.xml`, `build.gradle` or `build.gradle.kts`, never below `src/`. A Java package with one of those names (Spring's `org.springframework.aop.target`) is now in the inventory. Repositories without Java are unchanged.

---
"@n-dx/sourcevision": patch
---

Java is a recognised language. A repository with `pom.xml` or a Gradle build at the root (and no other language marker) is detected as Java, `java` is a valid `language` id, and Java files get inventory roles: tests under `src/test/java` or named `*Test`/`*Tests`/`*IT`, generated output, and Maven/Gradle/Spring config such as `application-*.yml`. Detection for every other repository is unchanged.

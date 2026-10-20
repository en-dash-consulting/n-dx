---
"@n-dx/sourcevision": patch
---

Read Gradle builds into the in-memory build model: version catalogs (`gradle/*.versions.toml`) exactly, and plugins, string and `libs.*` dependencies, the Java toolchain and the Spring Boot version from `build.gradle(.kts)`. Values read from a script are marked `bestEffort`; computed values stay unresolved.

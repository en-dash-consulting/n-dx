---
id: "24b251ed-e90b-42e9-af25-a3f5fb62628d"
type: "change"
title: "Discover Java modules and source roots"
slug: "discover-java-modules-and-source-roots"
intent: "Find every module and its source roots without running Maven or Gradle. Maven: the root pom.xml and each <modules> entry, recursively. Gradle: include(...) and include '...' entries in settings.gradle and settings.gradle.kts, with projectDir overrides when they are literal. Each module contributes src/main/java and src/test/java when present, plus any literal sourceDirectory or srcDirs it declares. Repositories with no build file fall back to directories whose files' package declarations match their path.\n\nThis is the module reader that the next feature extends with dependencies and versions; keep it in its own module so that feature can build on it."
acceptanceCriteria:
  - "Maven multi-module repositories list every module and its source roots, recursively"
  - "Gradle repositories with Groovy and Kotlin settings files list included modules and their source roots"
  - "A repository with no build file falls back to package-declaration roots"
  - "Unit tests cover single-module, multi-module Maven, Gradle Kotlin DSL and no-build-file layouts"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
source: "roadmap"
---

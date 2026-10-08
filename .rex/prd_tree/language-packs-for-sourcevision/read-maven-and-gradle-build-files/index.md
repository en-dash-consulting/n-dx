---
id: "63ab54d2-ab85-486b-bb55-dbc313f1d17b"
level: "feature"
title: "Read Maven and Gradle build files"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
blockedBy:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
source: "roadmap"
startedAt: "2026-10-08T06:07:19.329Z"
completedAt: "2026-10-08T06:07:19.329Z"
endedAt: "2026-10-08T06:07:19.329Z"
acceptanceCriteria:
  - "The build model lists each module's dependency coordinates with versions, its Java version and its Spring Boot version when present"
  - "Maven properties and dependencyManagement resolve within the repository; a parent or BOM from outside it leaves those versions marked unresolved"
  - "Gradle plugins and dependencies blocks and the version catalog are read for Groovy and Kotlin DSL, with script-derived values marked best-effort"
  - "Nothing new is written to analysis artifacts and project-profile.ts is unchanged"
  - "Fixture goldens cover Maven parent and BOM cases, Gradle Groovy, Gradle Kotlin DSL and a version catalog"
description: "Milestone L4. Extend the module reader with dependencies and versions: dependency coordinates with versions, the Java version, and the Spring Boot version when present. Maven pom.xml is data and is read exactly. Gradle build scripts are programs, so values read from them are best-effort and marked as such; the version catalog (gradle/libs.versions.toml) is data and is read exactly.\n\nScope for this phase: the build model stays in memory, used by the Java pack and covered by fixtures. Persisting versions into analysis artifacts, attaching them to externals and checking them against end-of-life data wait for phase 3, after the conversation with Sterling H about the meta-scan and readiness artifacts. No edits to project-profile.ts and no new committed paths.\n\nPhase 2 · one PR."
lastModified: "2026-10-08T06:07:19.576Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A grammar that loads but rejects a pack query fails the whole imports phase](./a-grammar-that-loads-but-rejects-a.md) | completed |
| [Read dependencies and versions from Gradle builds](./read-dependencies-and-versions-159603.md) | completed |
| [Read dependencies and versions from Maven pom files](./read-dependencies-and-versions-9c28bd.md) | completed |

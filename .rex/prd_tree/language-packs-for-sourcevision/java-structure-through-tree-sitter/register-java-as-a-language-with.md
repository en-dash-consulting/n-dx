---
id: "4554831e-6e96-470f-8f6c-1248ad9637d9"
level: "task"
title: "Register Java as a language with inventory roles"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "java"
source: "roadmap"
startedAt: "2026-10-08T01:38:26.909Z"
completedAt: "2026-10-08T01:43:47.231Z"
endedAt: "2026-10-08T01:43:47.231Z"
acceptanceCriteria:
  - "java.ts provides the Java LanguageConfig and java is accepted as a language id"
  - "A Maven or Gradle repository is detected as Java; detection results for existing fixtures are unchanged"
  - "Java test, generated and config files get the right inventory roles in a fixture repository"
  - "Unit tests cover Maven, Gradle and multi-module layouts"
description: "Add packages/sourcevision/src/language/java.ts with a LanguageConfig and register it in detect.ts (including the valid language ids). Extensions: .java. Test patterns: files under src/test/java, and names ending Test.java, Tests.java or IT.java. Generated patterns and skip directories: target/, build/, out/, .gradle/, and generated-sources/ or generated/ (Lombok, MapStruct and OpenAPI Generator output). Config filenames: pom.xml, build.gradle, build.gradle.kts, settings.gradle, settings.gradle.kts, gradle.properties, gradle/libs.versions.toml, application.properties, application.yml and application-*.yml. Entry points: classes with a public static void main. Module file: pom.xml.\n\nDetection treats a repository with pom.xml or a Gradle build at the root as Java. Mixed repositories keep their current primary-language rule; only add Java where nothing else matched before, so existing detection results do not change."
lastModified: "2026-10-08T01:43:47.477Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

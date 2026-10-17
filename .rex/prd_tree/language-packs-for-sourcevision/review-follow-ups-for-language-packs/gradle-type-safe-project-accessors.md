---
id: "2d9f8f9b-75d3-4920-8dba-bf091950f6f8"
level: "task"
title: "Gradle type-safe project accessors (testFixtures(projects.dao)) grant no cross-module Java test link"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-java"
  - "pr-18"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "readGradleBuildModels records `testImplementation(testFixtures(projects.dao))` as { path: ':dao', testFixtures: true } in projects"
  - "A kebab-case project (include 'dao-core') is matched from `projects.daoCore`"
  - "A lang-java resolver test links a test to the provider's testFixtures class through a type-safe accessor dependency"
  - "No 'computed in the build script' notice is emitted for a resolvable `projects.x` accessor"
description: "Verdict: should-fix, low. Found reviewing 2b997e79 (commit 9132a9e5f).\n\nThe new projectDependency in packages/lang-kit/src/java-gradle-build.ts reads only `project(...)` calls, so Gradle's type-safe project accessors (`enableFeaturePreview(\"TYPESAFE_PROJECT_ACCESSORS\")`) record nothing in ModuleBuildModel.projects. Scenario: app/build.gradle.kts has `testImplementation(testFixtures(projects.dao))`; a test in app references dao/src/testFixtures/java/.../DaoFixture → no edge, the same refusal as before 2b997e79. A bare `projects.dao` also falls through to resolveCatalogRef and is noted as \"computed in the build script\".\n\nReachable in modern Kotlin DSL builds through ndx analyze (lang-java forProject → readTestArtifactGrants → readGradleBuildModels). It loses edges and never gives a wrong one, so it is low severity.\n\nFix: in projectDependency, map `projects.<a>.<b>` to path `:<a>:<b>`. Gradle derives accessor names from project names in kebab or snake case converted to camelCase, so match by comparing the camelCased form of each settings project path, not by guessing the reverse. This is cheap: a lookup built from the module names readGradleBuildModels already has. The only risk is ambiguity when two projects' names camelCase to the same accessor; skip those with a notice. The recommended approach is the module-name lookup."
lastModified: "2026-10-17T08:11:40.387Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

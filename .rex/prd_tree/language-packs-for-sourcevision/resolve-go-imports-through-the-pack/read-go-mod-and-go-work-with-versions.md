---
id: "db21d009-cd14-4b1e-8338-b560798fa7c9"
level: "task"
title: "Read go.mod and go.work with versions"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-7"
source: "roadmap"
acceptanceCriteria:
  - "go.mod fixtures cover require blocks, indirect deps, both replace forms, exclude and the toolchain directive"
  - "go.work fixtures cover use and replace"
  - "Nothing new is written to analysis artifacts"
  - "A follow-up item records the duplicate go.mod parser in rex"
  - "The six static root policy tests pass"
description: "Add a Go build reader in sourcevision: from go.mod, the module path, the go and toolchain directives, require entries (with versions and the // indirect marker), replace (both local-path and version forms) and exclude; from go.work, the use and replace directives. Keep the model in memory, like the Java build model; persisting versions waits for the conversation with Sterling H. rex has its own go.mod parser (rex/src/analyze/scanners.ts parseGoMod); domain packages may not import each other, so write sourcevision's own and file a follow-up to consolidate the two.\n\nOutput shape (PR 5 merged 2026-10-08): return the shared in-memory ModuleBuildModel from src/language/build-model.ts, one per go.mod module, with buildSystem \"go\", from a readGoBuildModels(projectDir, ...) that mirrors readMavenBuildModels in java-maven-build.ts and readGradleBuildModels in java-gradle-build.ts (async, unreadable or malformed files become notices, never a throw; dependencies sorted as build-model.ts documents). Follow the field conventions build-model.ts already gives Go: group is the module path prefix, artifact the last path element; use scope for direct vs indirect. Go-only facts with no shared field (go and toolchain directives, replace, exclude, go.work use) go in a Go-specific type next to the reader, not as new optional fields on the shared types."
lastModified: "2026-10-08T06:15:08.665Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

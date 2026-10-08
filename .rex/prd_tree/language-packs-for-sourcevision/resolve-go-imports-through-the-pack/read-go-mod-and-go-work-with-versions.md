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
description: "Add a Go build reader in sourcevision: from go.mod, the module path, the go and toolchain directives, require entries (with versions and the // indirect marker), replace (both local-path and version forms) and exclude; from go.work, the use and replace directives. Keep the model in memory, like the Java build model; persisting versions waits for the conversation with Sterling H. rex has its own go.mod parser (rex/src/analyze/scanners.ts parseGoMod); domain packages may not import each other, so write sourcevision's own and file a follow-up to consolidate the two."
lastModified: "2026-10-08T03:08:56.513Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

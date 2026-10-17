---
id: "ac26cb7d-b471-45c9-849b-1423d936d015"
level: "task"
title: "Resolve Go import paths to package files"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-7"
blockedBy:
  - "db21d009-cd14-4b1e-8338-b560798fa7c9"
source: "roadmap"
startedAt: "2026-10-08T06:26:08.315Z"
completedAt: "2026-10-08T06:47:31.659Z"
endedAt: "2026-10-08T06:47:31.659Z"
resolutionType: "code-change"
resolutionDetail: "Added src/language/go-resolver.ts (goResolver + forProject reading go.mod/go.work/vendor/modules.txt), PackResolver.forProject hook, fixture tests/fixtures/go-resolver and integration tests incl. regex parity on go-project."
acceptanceCriteria:
  - "Imports resolve through module path, go.work modules, local replace directives and vendor/"
  - "Stdlib and external modules are classified as the regex parser classifies them"
  - "Fixtures cover a go.work multi-module repo and a local replace"
  - "The six static root policy tests pass"
description: "Give the Go pack a resolver with a project-level prepare step (as Java's does). Map an import path to a package directory: the module path prefix from go.mod, each module in go.work, replace directives that point at local directories, and vendor/. Stdlib is detected as today (reuse the existing list in go-imports.ts). Everything else is external, attributed to its module, with the version available in memory. Match the edge semantics of the current regex parser (which files of the target package an import connects to); where they differ deliberately, say why in the goldens."
lastModified: "2026-10-08T06:47:32.535Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

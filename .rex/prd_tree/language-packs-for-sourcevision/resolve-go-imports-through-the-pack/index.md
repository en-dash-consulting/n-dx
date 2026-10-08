---
id: "72b0abf4-b4be-4c2a-8336-dd84824ed71b"
level: "feature"
title: "Resolve Go imports through the pack"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "side-stack"
  - "pr-7"
blockedBy:
  - "2fc859c0-090f-43bb-b1b4-36415478bae8"
source: "roadmap"
acceptanceCriteria:
  - "go.mod and go.work are read with module paths, directives and dependency versions"
  - "Go import edges come from the pack and match or improve on the regex parser across the corpus, with every difference listed"
  - "Without the Go grammar, Go import edges still come from the regex parser"
  - "Analysis output for non-Go repositories is unchanged"
  - "The six static root policy tests pass"
description: "Move Go import edges from the regex parser to the Go pack once the pack matches or beats it. Read go.mod and go.work (with versions, held in memory), resolve import paths to package files, and switch the imports phase over. Without a built grammar, Go falls back to the regex parser rather than to inventory-only, so no Go repository loses edges.\n\nSide stack, PR 7. Merge the final Java PR 4 into this stack before starting, because this feature edits the same imports wiring."
lastModified: "2026-10-08T03:08:53.534Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Go build reader throws when a project subdirectory is unreadable](./go-build-reader-throws-when-a-project.md) | completed |
| [Go resolver drops the edge to a package whose files were all skipped by the parser](./go-resolver-drops-the-edge-to-a.md) | pending |
| [Read go.mod and go.work with versions](./read-go-mod-and-go-work-with-versions.md) | completed |
| [Resolve Go import paths to package files](./resolve-go-import-paths-to-package-files.md) | completed |
| [Switch Go import edges from the regex parser to the pack](./switch-go-import-edges-from-the-regex.md) | pending |

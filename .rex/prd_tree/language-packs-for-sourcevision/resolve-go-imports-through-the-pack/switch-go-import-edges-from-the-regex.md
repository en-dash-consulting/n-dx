---
id: "ab5f9130-3afb-4704-9d7d-3303eea8f9c9"
level: "task"
title: "Switch Go import edges from the regex parser to the pack"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-7"
blockedBy:
  - "ac26cb7d-b471-45c9-849b-1423d936d015"
source: "roadmap"
acceptanceCriteria:
  - "Go import edges come from the pack when the grammar is built"
  - "Without the grammar, Go edges still come from the regex parser, with a test"
  - "Corpus parity is recorded in the rex log, with every difference explained"
  - "Incremental analysis of a Go repo keeps no stale edges, with a test"
  - "The six static root policy tests pass"
description: "Route .go files through the pack in the imports phase instead of processGoFiles, keeping processGoFiles as the fallback when the Go grammar is not built (Go must never degrade to inventory-only). Run the Go corpus parity report: edges and externals must match the regex output or differ only in listed, explained improvements. Keep incremental analysis correct (the same changedFiles handling as Java).\n\nKnown parity difference (42d5dba1, gitea @89ec271d): modules/charset/generate/generate.go, where the regex parser counts two import \"unicode\" lines inside a code-generation template string. The pack is right; list it as an improvement, not a regression."
lastModified: "2026-10-08T05:43:28.370Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

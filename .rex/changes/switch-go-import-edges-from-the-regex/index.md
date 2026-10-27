---
id: "ab5f9130-3afb-4704-9d7d-3303eea8f9c9"
type: "change"
title: "Switch Go import edges from the regex parser to the pack"
slug: "switch-go-import-edges-from-the-regex"
intent: "Route .go files through the pack in the imports phase instead of processGoFiles, keeping processGoFiles as the fallback when the Go grammar is not built (Go must never degrade to inventory-only). Run the Go corpus parity report: edges and externals must match the regex output or differ only in listed, explained improvements. Keep incremental analysis correct (the same changedFiles handling as Java).\n\nKnown parity difference (42d5dba1, gitea @89ec271d): modules/charset/generate/generate.go, where the regex parser counts two import \"unicode\" lines inside a code-generation template string. The pack is right; list it as an improvement, not a regression.\n\nFallback scope (after the PR 4 and PR 5 merges): buildPackImportGraph in analyzers/pack-imports.ts degrades a pack to inventory-only in three cases: grammar missing (loadLanguagePacks mode), grammar present but fails to load (PR 4), and a query that fails to compile (PR 5, 302b3909). Java accepts inventory-only; Go must not. In all three cases Go edges must come from processGoFiles, with a test for each path.\n\nFourth degrade path (ac26cb7d review): the Go resolver's project-level prepare (forProject / readGoProject) runs outside buildPackImportGraph's per-pack try. If it rejects, Go must fall back to processGoFiles like the other three cases rather than failing the imports phase; cover it with a test."
acceptanceCriteria:
  - "Go import edges come from the pack when the grammar is built"
  - "Without the grammar, Go edges still come from the regex parser, with a test"
  - "Corpus parity is recorded in the rex log, with every difference explained"
  - "Incremental analysis of a Go repo keeps no stale edges, with a test"
  - "The six static root policy tests pass"
  - "A buildPackImportGraph-level test with a Go package whose only file is over the runner size limit keeps its import edge (covers ffbb80bf)"
amends: [{"target":"72b0abf4-b4be-4c2a-8336-dd84824ed71b","delta":"modified","summary":"Switch Go import edges from the regex parser to the pack","base":"f6a8ba52d0bd4e2b2cade0e09fbfd6fc82ebbf8484da1596c4e52f17991032c5"}]
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-7"
source: "roadmap"
blockedBy:
  - "ac26cb7d-b471-45c9-849b-1423d936d015"
  - "e6ce4e7e-10ec-4a5c-b9aa-a2ba08cbbd1c"
  - "0307f4fb-36f5-4770-8701-75bb42ac3726"
---

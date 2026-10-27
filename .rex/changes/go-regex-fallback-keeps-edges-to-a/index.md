---
id: "ba014e82-6547-423c-933c-4ffdbdbef321"
type: "change"
title: "Go regex fallback keeps edges to a package directory the inventory no longer holds"
slug: "go-regex-fallback-keeps-edges-to-a"
intent: "When the Go pack is degraded (tree-sitter-go grammar not built, the default for a local checkout), every Go file goes to the regex import parser, which resolves a module import to the directory on disk whether or not the inventory holds a file there. An import of a package pruned from the inventory (e.g. by .sourcevisionignore) keeps its edge, on full and incremental runs alike: the #744 defect, fixed only on the pack path. packages/sourcevision/tests/integration/imports-go-incremental-carryover.test.ts 'drops edges to a package directory whose files are no longer inventoried' fails deterministically on main (9b42df146) on any machine without the grammar, while CI builds the grammar and passes; it fails pnpm validate locally. Found while investigating 7db88b02. Fix: resolve regex Go edges against the inventoried directory set, as buildIncrementalState's targetExists already does for carried edges."
acceptanceCriteria:
  - "On a checkout without the Go grammar built, the carry-over test passes"
  - "A full (non-incremental) run with a pruned package directory emits no edge to it on the regex path"
  - "The pack path's results are unchanged"
  - "A test runs the regex path explicitly, so the suite covers it whether or not the grammar is built"
touches:
  - "a83b1a2f-8315-4ba6-b10b-d70ba4f68479"
priority: "high"
source: "ndx-work"
---

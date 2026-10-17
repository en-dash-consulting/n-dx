---
id: "2fc859c0-090f-43bb-b1b4-36415478bae8"
level: "feature"
title: "Go structure through tree-sitter"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "side-stack"
  - "pr-6"
source: "roadmap"
startedAt: "2026-10-08T05:32:18.445Z"
endedAt: "2026-10-08T05:32:18.445Z"
acceptanceCriteria:
  - "The Go grammar builds from a pinned release and loads in Node"
  - "Go structure query goldens cover packages, every import form, types, functions and methods with spans, calls and struct tags"
  - "Files with Go's generated-code header are classified as generated"
  - "On the Go drift corpus at least 98% of .go files parse cleanly, and import parity with the regex parser is measured and recorded in the rex log"
  - "Import edges for Go repositories are unchanged in this PR"
  - "The six static root policy tests pass"
description: "LS11 (decided 2026-10-08): port Go to tree-sitter now, with today's regex import parser (analyzers/go-imports.ts) and route detection as the parity answer key. This feature builds the grammar, the structure queries and generated-file detection, and measures parse rate and import parity on a pinned corpus. Go keeps using the regex parser for import edges in this PR; switching to the pack is the next feature.\n\nSide stack, PR 6: cut from the Java PR 4 tip and run in a parallel session. Java PR 4 and PR 5 are merged into this branch later (merges only, no rebase), so keep shared files (pack.ts BUILTIN_PACKS, build-grammars.mjs GRAMMARS, detect.ts, ci.yml) to small additive edits."
lastModified: "2026-10-17T01:21:27.859Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add the missing changeset for Go files that declare themselves generated](./add-the-missing-changeset-for-go-files.md) | pending |
| [Build the Go grammar to WASM from a pinned release](./build-the-go-grammar-to-wasm-from-a.md) | completed |
| [Detect Go generated files from the Code generated header](./detect-go-generated-files-from-the.md) | completed |
| [Seed the Go drift corpus and measure parse rate and import parity](./seed-the-go-drift-corpus-and-measure.md) | completed |
| [Write the Go structure queries with goldens](./write-the-go-structure-queries-with.md) | completed |

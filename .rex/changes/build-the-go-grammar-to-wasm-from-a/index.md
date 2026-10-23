---
id: "8f4d555e-67a4-4ded-b67a-029211d5508b"
type: "change"
title: "Build the Go grammar to WASM from a pinned release"
slug: "build-the-go-grammar-to-wasm-from-a"
intent: "Add tree-sitter-go v0.25.0 (github.com/tree-sitter/tree-sitter-go, latest release on 2026-10-08) to the GRAMMARS pins in packages/sourcevision/scripts/build-grammars.mjs with its source-archive checksum, following the Java entry exactly. The script, cache and CI step already handle more than one grammar; keep the edit additive. Add an integration test that loads the built Go grammar and parses a small Go file without ERROR nodes, skipping (or failing under SV_REQUIRE_GRAMMARS=1) when it is not built."
acceptanceCriteria:
  - "build-grammars.mjs builds tree-sitter-go.wasm from v0.25.0 with a pinned checksum"
  - "An integration test parses a Go file with the built grammar and honours SV_REQUIRE_GRAMMARS"
  - "No .wasm is committed"
  - "The six static root policy tests pass"
touches:
  - "2fc859c0-090f-43bb-b1b4-36415478bae8"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-6"
source: "roadmap"
---

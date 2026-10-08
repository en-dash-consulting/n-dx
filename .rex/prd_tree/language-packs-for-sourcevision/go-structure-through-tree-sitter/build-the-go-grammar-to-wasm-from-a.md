---
id: "8f4d555e-67a4-4ded-b67a-029211d5508b"
level: "task"
title: "Build the Go grammar to WASM from a pinned release"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-6"
source: "roadmap"
acceptanceCriteria:
  - "build-grammars.mjs builds tree-sitter-go.wasm from v0.25.0 with a pinned checksum"
  - "An integration test parses a Go file with the built grammar and honours SV_REQUIRE_GRAMMARS"
  - "No .wasm is committed"
  - "The six static root policy tests pass"
description: "Add tree-sitter-go v0.25.0 (github.com/tree-sitter/tree-sitter-go, latest release on 2026-10-08) to the GRAMMARS pins in packages/sourcevision/scripts/build-grammars.mjs with its source-archive checksum, following the Java entry exactly. The script, cache and CI step already handle more than one grammar; keep the edit additive. Add an integration test that loads the built Go grammar and parses a small Go file without ERROR nodes, skipping (or failing under SV_REQUIRE_GRAMMARS=1) when it is not built."
lastModified: "2026-10-08T03:08:40.748Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

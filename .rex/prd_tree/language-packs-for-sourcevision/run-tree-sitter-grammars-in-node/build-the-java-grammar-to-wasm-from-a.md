---
id: "4c2738d2-c2e3-4656-b21c-0f281ee81cc5"
level: "task"
title: "Build the Java grammar to WASM from a pinned release"
status: "in_progress"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
source: "roadmap"
startedAt: "2026-10-08T00:06:42.193Z"
acceptanceCriteria:
  - "Running the script on a clean checkout produces tree-sitter-java.wasm in a gitignored directory"
  - "The grammar version and its checksum are pinned in one place"
  - "web-tree-sitter is a pinned dependency of @n-dx/sourcevision; no native addon is added"
  - "A vitest test loads the built grammar and parses a small Java class without ERROR nodes, and skips with a clear message when the grammar has not been built"
description: "Add a script under packages/sourcevision/scripts/ that fetches a pinned tree-sitter-java release (version and checksum written in the script) and builds tree-sitter-java.wasm with the tree-sitter CLI. Output goes to a gitignored build directory inside sourcevision; nothing is committed.\n\nFind a build path that does not need Docker or a native compiler on developer machines (for example a CLI version that fetches its own WASI toolchain). If none works, use the smallest dependency that does and state it, with the reason, in the rex log for this task. Add web-tree-sitter as a sourcevision dependency, pinned exactly. The npm package tree-sitter-java is not used at runtime: it ships a node-gyp native binding."
lastModified: "2026-10-08T00:06:42.439Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

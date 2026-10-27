---
id: "6b72bf55-a1d6-4f7c-b6db-812c74e0f120"
type: "change"
title: "Add a tree-sitter runner that executes pack queries"
slug: "add-a-tree-sitter-runner-that-executes"
intent: "Add a runner in packages/sourcevision/src/language/ that initialises web-tree-sitter once per process, loads each grammar lazily on first use, parses a file, runs a pack's named query files and returns captures with node type, text, and start and end positions. It also reports whether the tree contains ERROR or MISSING nodes, so later features can compute a parse rate. Every tree and query object is freed after use, and files above a size limit are skipped and counted rather than parsed."
acceptanceCriteria:
  - "web-tree-sitter is initialised once and each grammar loads at most once per process"
  - "Captures carry name, node type, text, and start and end line and column"
  - "Each parse reports whether ERROR or MISSING nodes are present"
  - "Trees and queries are freed; a test parses many files in a loop without memory growing without bound"
  - "Oversized files are skipped and counted"
amends: [{"target":"9ad52cf9-3451-48de-b65e-7b9dfd98411b","delta":"modified","summary":"Add a tree-sitter runner that executes pack queries","base":"0c9addd6403363d2ad142d067aff6ffb39bab54e8ceddbbe325a87d4188ea773"}]
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
source: "roadmap"
blockedBy:
  - "45954c7d-9a7d-4c29-a050-32e2657a8414"
---

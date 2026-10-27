---
id: "21053225-b2aa-42d4-aa96-266c5da07491"
type: "change"
title: "Implement folder-tree-to-PRD parser that aggregates index.md files into the PRD item tree"
slug: "implement-folder-tree-to-prd-parser"
intent: "Build the inverse of the serializer: traverse the .rex/prd/ folder hierarchy, parse each index.md, and reconstruct the full PRD item tree in memory. The parser must handle missing files, malformed frontmatter, and partial trees without aborting, and must emit structured warnings for any items it cannot read."
acceptanceCriteria:
  - "Round-trip fidelity: serialize then parse a 100-item PRD and assert zero data loss across all fields"
  - "Parser emits structured warnings for missing or malformed index.md files without throwing"
  - "Parse order is deterministic (alphabetical by folder name) and matches serializer write order"
  - "Parser correctly reconstructs parent-child relationships solely from folder nesting depth"
  - "Parsing a 200-item PRD tree completes in under 500 ms on a cold filesystem"
amends: [{"target":"7286f1c2-ad19-4f85-baa9-cebb3c77a49d","delta":"modified","summary":"Implement folder-tree-to-PRD parser that aggregates index.md files into the PRD item tree","base":"f655ec53f906fbb1d1497cb8d1c154cbbe36f07d40f2f25b8a648802f5c2c3a6"}]
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "parser"
source: "smart-add"
---

---
id: "21053225-b2aa-42d4-aa96-266c5da07491"
level: "task"
title: "Implement folder-tree-to-PRD parser that aggregates index.md files into the PRD item tree"
status: "completed"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "parser"
source: "smart-add"
startedAt: "2026-04-27T18:53:00.057Z"
completedAt: "2026-04-27T19:02:01.536Z"
endedAt: "2026-04-27T19:02:01.536Z"
acceptanceCriteria:
  - "Round-trip fidelity: serialize then parse a 100-item PRD and assert zero data loss across all fields"
  - "Parser emits structured warnings for missing or malformed index.md files without throwing"
  - "Parse order is deterministic (alphabetical by folder name) and matches serializer write order"
  - "Parser correctly reconstructs parent-child relationships solely from folder nesting depth"
  - "Parsing a 200-item PRD tree completes in under 500 ms on a cold filesystem"
description: "Build the inverse of the serializer: traverse the .rex/prd/ folder hierarchy, parse each index.md, and reconstruct the full PRD item tree in memory. The parser must handle missing files, malformed frontmatter, and partial trees without aborting, and must emit structured warnings for any items it cannot read."
---

# Implement folder-tree-to-PRD parser that aggregates index.md files into the PRD item tree

🔴 [completed]

## Summary

Build the inverse of the serializer: traverse the .rex/prd/ folder hierarchy, parse each index.md, and reconstruct the full PRD item tree in memory. The parser must handle missing files, malformed frontmatter, and partial trees without aborting, and must emit structured warnings for any items it cannot read.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** prd, storage, parser
- **Level:** task
- **Started:** 2026-04-27T18:53:00.057Z
- **Completed:** 2026-04-27T19:02:01.536Z
- **Duration:** 9m

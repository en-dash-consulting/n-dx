---
id: "6acff042-3eb9-4fde-bd59-159a8324a88d"
level: "task"
title: "Auto-promote leaf subtask .md files to folder-with-index.md when children are added"
status: "completed"
priority: "high"
tags:
  - "prd-storage"
  - "migration"
  - "serializer"
source: "smart-add"
startedAt: "2026-05-08T04:46:38.321Z"
completedAt: "2026-05-08T05:38:06.205Z"
endedAt: "2026-05-08T05:38:06.205Z"
resolutionType: "code-change"
resolutionDetail: "Completed atomic promotion logic implementation. Fixed 2 issues from Phase 2: (1) Migration logic now correctly detects bare task files with children at parent levels and migrates them to folders. (2) Validation logic now correctly enforces subtask parent requirements despite recursive nesting schema changes. All 7 migration tests and 65 recommendation tests passing."
acceptanceCriteria:
  - "Adding a child to a leaf .md subtask via any write path (rex CLI, MCP, plan accept) converts the .md to folder/index.md and writes the child"
  - "The promoted index.md preserves every field (frontmatter, body, status, tags, branch attribution, etc.) from the original .md file"
  - "Promotion is atomic: a simulated crash between the rename and the index.md write leaves the tree in either the pre- or post-promotion state, never a half-promoted state"
  - "Unit and integration tests cover promotion across all write entry points"
  - "No data loss is observable via parser round-trip after promotion"
description: "When any write path attempts to add a child under a subtask that currently exists as a leaf .md file, atomically convert the .md file into a folder of the same title slug, move its content into a new index.md inside that folder, then write the new child alongside it. This must happen transparently for rex CLI, MCP add_item, ndx plan acceptance, and any other code path that creates children. Use atomic rename/write semantics so a crash mid-promotion leaves either the old .md file or the new folder, never both."
---

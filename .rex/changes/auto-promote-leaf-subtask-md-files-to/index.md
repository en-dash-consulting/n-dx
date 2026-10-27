---
id: "6acff042-3eb9-4fde-bd59-159a8324a88d"
type: "change"
title: "Auto-promote leaf subtask .md files to folder-with-index.md when children are added"
slug: "auto-promote-leaf-subtask-md-files-to"
intent: "When any write path attempts to add a child under a subtask that currently exists as a leaf .md file, atomically convert the .md file into a folder of the same title slug, move its content into a new index.md inside that folder, then write the new child alongside it. This must happen transparently for rex CLI, MCP add_item, ndx plan acceptance, and any other code path that creates children. Use atomic rename/write semantics so a crash mid-promotion leaves either the old .md file or the new folder, never both."
acceptanceCriteria:
  - "Adding a child to a leaf .md subtask via any write path (rex CLI, MCP, plan accept) converts the .md to folder/index.md and writes the child"
  - "The promoted index.md preserves every field (frontmatter, body, status, tags, branch attribution, etc.) from the original .md file"
  - "Promotion is atomic: a simulated crash between the rename and the index.md write leaves the tree in either the pre- or post-promotion state, never a half-promoted state"
  - "Unit and integration tests cover promotion across all write entry points"
  - "No data loss is observable via parser round-trip after promotion"
touches:
  - "f8638a30-55d9-48c3-85b8-c6006600c138"
priority: "high"
tags:
  - "prd-storage"
  - "migration"
  - "serializer"
source: "smart-add"
---

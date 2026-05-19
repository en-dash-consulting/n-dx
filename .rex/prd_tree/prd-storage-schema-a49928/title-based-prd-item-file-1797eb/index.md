---
id: "1797eb3e-8ef9-4148-80fe-966693dd4e97"
level: "feature"
title: "Title-Based PRD Item File Naming Convention"
status: "pending"
source: "smart-add"
startedAt: "2026-04-30T01:26:33.258Z"
endedAt: "2026-04-30T01:26:33.258Z"
acceptanceCriteria: []
description: "Replace the current per-item `index.md` convention with markdown files named after the item title (lowercase, underscores instead of spaces, punctuation stripped). Each PRD item folder will contain one title-named markdown file holding the item's primary content; `index.md` is repurposed by a separate feature into a folder-level summary."
---

## Children

| Title | Status |
|-------|--------|
| [Add resolveItem helper that falls back to title matching when ID lookup misses](./add-resolveitem-helper-that-21d748.md) | completed |
| [Define title-to-filename normalization rules and implement pure helper](./define-title-to-filename-d429d9.md) | completed |
| [Implement migration command to rename legacy index.md files to title-based names](./implement-migration-command-to-0f659c.md) | completed |
| [Update PRD folder-tree serializer and parser to read/write title-named markdown files](./update-prd-folder-tree-4ab625.md) | completed |
| [Wire resolveItem into MCP get_item and CLI commands that accept item identifiers](./wire-resolveitem-into-mcp-get-7a7e84.md) | pending |

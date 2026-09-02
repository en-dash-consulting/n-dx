---
id: "c94d8eed-5685-48c6-8263-d796974538ed"
level: "feature"
title: "Rename .rex/tree to .rex/prd_tree as Canonical PRD Storage Location"
status: "completed"
source: "smart-add"
startedAt: "2026-05-06T13:26:49.125Z"
completedAt: "2026-05-06T13:26:49.125Z"
endedAt: "2026-05-06T13:26:49.125Z"
acceptanceCriteria: []
description: "Rename the canonical PRD folder-tree storage directory from .rex/tree to .rex/prd_tree across all read/write call sites, configuration, documentation, and tests. The new name communicates more clearly that this directory holds the authoritative PRD task hierarchy and avoids the generic 'tree' name."
---

## Children

| Title | Status |
|-------|--------|
| [Rename .rex/tree path constants and update all serializer/parser/store call sites](./rename-rex-tree-path-constants-235b32.md) | completed |
| [Update CLAUDE.md, README, and folder-tree schema docs to reference .rex/prd_tree](./update-claude-md-readme-and-48ac9b.md) | completed |

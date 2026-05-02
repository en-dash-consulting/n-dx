---
id: "c94d8eed-5685-48c6-8263-d796974538ed"
level: "feature"
title: "Rename .rex/tree to .rex/prd_tree as Canonical PRD Storage Location"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Rename the canonical PRD folder-tree storage directory from .rex/tree to .rex/prd_tree across all read/write call sites, configuration, documentation, and tests. The new name communicates more clearly that this directory holds the authoritative PRD task hierarchy and avoids the generic 'tree' name."
---

## Children

| Title | Status |
|-------|--------|
| [Rename .rex/tree path constants and update all serializer/parser/store call sites](./rename-rex-tree-path-constants-235b32/index.md) | pending |
| [Update CLAUDE.md, README, and folder-tree schema docs to reference .rex/prd_tree](./update-claude-md-readme-and-48ac9b/index.md) | pending |

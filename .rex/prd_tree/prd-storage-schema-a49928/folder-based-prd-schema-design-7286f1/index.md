---
id: "7286f1c2-ad19-4f85-baa9-cebb3c77a49d"
level: "feature"
title: "Folder-Based PRD Schema Design and Serialization"
status: "completed"
source: "smart-add"
startedAt: "2026-04-27T19:20:57.818Z"
completedAt: "2026-04-27T19:20:57.818Z"
endedAt: "2026-04-27T19:20:57.818Z"
acceptanceCriteria: []
description: "Define and implement a folder-tree layout where each PRD level (epic → feature → task) maps to a directory containing an index.md. Parent directories recursively summarize everything below them. Tasks are leaf folders — their index.md contains subtasks as sections rather than nested directories."
---

## Children

| Title | Status |
|-------|--------|
| [Design folder naming conventions, index.md content schema, and recursive summary contract for each PRD level](./design-folder-naming-69ff95.md) | completed |
| [Implement folder-tree-to-PRD parser that aggregates index.md files into the PRD item tree](./implement-folder-tree-to-prd-210532.md) | completed |
| [Implement PRD-to-folder-tree serializer that writes nested directories with index.md files](./implement-prd-to-folder-tree-3b8010.md) | completed |

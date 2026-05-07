---
id: "84a54eee-5e54-43c0-8232-fa8929e64e33"
level: "feature"
title: "Single-Child Container Elimination in PRD Folder Tree"
status: "completed"
source: "smart-add"
startedAt: "2026-05-06T20:21:02.605Z"
completedAt: "2026-05-06T20:21:02.605Z"
endedAt: "2026-05-06T20:21:02.605Z"
acceptanceCriteria: []
description: "Eliminate unnecessary wrapper directories in the PRD folder tree when a parent container holds exactly one child item plus an index.md. The current serializer always creates a directory + index.md for every feature/epic, even when a single child task makes the container redundant. This adds noise to the file tree and complicates tooling. The fix spans two surfaces: the write path (prevent over-creation going forward) and a reshape migration pass (flatten existing over-wrapped directories in repos already on disk)."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for single-child compaction across write path and reshape migration](./add-regression-tests-for-single-7acad3/index.md) | completed |
| [Add single-child detection to PRD folder-tree serializer to skip container directory when parent has exactly one child](./add-single-child-detection-to-2d77d0/index.md) | completed |
| [Implement single-child compaction migration pass in `ndx reshape` to flatten existing over-wrapped directories](./implement-single-child-f2f520/index.md) | completed |

---
id: "2d77d055-20f4-4d3b-b1b4-73bf7133cd35"
level: "task"
title: "Add single-child detection to PRD folder-tree serializer to skip container directory when parent has exactly one child"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "prd-storage"
  - "folder-tree"
source: "smart-add"
startedAt: "2026-05-06T19:08:38.021Z"
completedAt: "2026-05-06T19:51:21.286Z"
endedAt: "2026-05-06T19:51:21.286Z"
resolutionType: "code-change"
resolutionDetail: "Implemented single-child detection in PRD folder-tree serializer and parser. Serializer skips parent directory creation when a feature (or lower-level container) has exactly one child, embedding parent metadata in child's frontmatter using __parent* fields. Parser reconstructs parent-child relationships from embedded metadata, handling ancestor chains for nested single-children. All 29 parser tests passing, including 5 new single-child optimization tests validating round-trip serialization, metadata preservation, multi-child control, and nested chains."
acceptanceCriteria:
  - "Serializing a feature with exactly one task writes only the task file directly under the parent directory, with no subdirectory or index.md created for that feature"
  - "Serializing a feature with two or more tasks produces the existing subdirectory + index.md structure unchanged"
  - "Round-trip parser test: a single-child folder tree can be parsed back to an equivalent PRD item tree with all metadata preserved"
  - "Existing serializer unit tests pass without modification for multi-child cases"
description: "Modify the PRD folder-tree serializer so that when a feature (or lower-level container) has exactly one task, it writes the child item file directly into the parent directory instead of creating a new subdirectory with an index.md. The detection logic should compare the child count of each node before materializing directories. Index.md creation for the parent container should be skipped only when the single-child rule applies; multi-child containers are unaffected. Parser round-trip must remain lossless — the parent metadata (title, status, description) should collapse into the child item's frontmatter or be stored inline."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:3b80109b-5158-4236-8052-6571bb9f69e9","matchedItemId":"3b80109b-5158-4236-8052-6571bb9f69e9","matchedItemTitle":"Implement PRD-to-folder-tree serializer that writes nested directories with index.md files","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-05-06T19:08:16.745Z"}
---

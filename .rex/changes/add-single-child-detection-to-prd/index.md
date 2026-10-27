---
id: "2d77d055-20f4-4d3b-b1b4-73bf7133cd35"
type: "change"
title: "Add single-child detection to PRD folder-tree serializer to skip container directory when parent has exactly one child"
slug: "add-single-child-detection-to-prd"
intent: "Modify the PRD folder-tree serializer so that when a feature (or lower-level container) has exactly one task, it writes the child item file directly into the parent directory instead of creating a new subdirectory with an index.md. The detection logic should compare the child count of each node before materializing directories. Index.md creation for the parent container should be skipped only when the single-child rule applies; multi-child containers are unaffected. Parser round-trip must remain lossless — the parent metadata (title, status, description) should collapse into the child item's frontmatter or be stored inline."
acceptanceCriteria:
  - "Serializing a feature with exactly one task writes only the task file directly under the parent directory, with no subdirectory or index.md created for that feature"
  - "Serializing a feature with two or more tasks produces the existing subdirectory + index.md structure unchanged"
  - "Round-trip parser test: a single-child folder tree can be parsed back to an equivalent PRD item tree with all metadata preserved"
  - "Existing serializer unit tests pass without modification for multi-child cases"
amends: [{"target":"84a54eee-5e54-43c0-8232-fa8929e64e33","delta":"modified","summary":"Add single-child detection to PRD folder-tree serializer to skip container directory when parent has exactly one child","base":"247fad4c8526ecc1bb2031b6e8bd1efb47a18e07f74dfed2d3f045a53e64d6d0"}]
priority: "high"
tags:
  - "rex"
  - "prd-storage"
  - "folder-tree"
source: "smart-add"
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:3b80109b-5158-4236-8052-6571bb9f69e9","matchedItemId":"3b80109b-5158-4236-8052-6571bb9f69e9","matchedItemTitle":"Implement PRD-to-folder-tree serializer that writes nested directories with index.md files","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-05-06T19:08:16.745Z"}
---

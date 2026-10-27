---
id: "95037bd6-871c-4a16-bf90-90a081dbfe9e"
type: "change"
title: "Add branch and source-file fields to PRD item schema and storage"
slug: "add-branch-and-source-file-fields-to"
intent: "PRD items currently carry no record of which git branch or PRD file they originate from. Adding optional `branch` and `sourceFile` fields to the item schema is the prerequisite for all downstream attribution display. The fields must survive JSON round-trips and remain backward-compatible so existing PRD files need no migration."
acceptanceCriteria:
  - "PRD item schema accepts optional `branch: string` and `sourceFile: string` fields at all levels (epic, feature, task, subtask)"
  - "Fields are preserved through JSON serialization and deserialization without data loss"
  - "Existing items that lack these fields remain valid and load without error"
  - "`rex status --format=json` output includes `branch` and `sourceFile` when present on an item"
amends: [{"target":"578686b2-4fab-45a3-a452-28a8dc45231f","delta":"modified","summary":"Add branch and source-file fields to PRD item schema and storage","base":"c2c8a5612dedbe0bd58e698eec953236558e18943e5808bc15a1acafbe727369"}]
priority: "high"
tags:
  - "rex"
  - "schema"
  - "backend"
source: "smart-add"
---

---
id: "c9c4ea2f-cfc6-4ff3-946e-3021df15d4e8"
level: "task"
title: "Define and implement slug generation rules for PRD folder names at all hierarchy levels"
status: "completed"
priority: "high"
tags:
  - "prd"
  - "storage"
  - "naming"
source: "smart-add"
startedAt: "2026-04-29T15:42:13.527Z"
completedAt: "2026-04-29T15:58:54.534Z"
endedAt: "2026-04-29T15:58:54.534Z"
acceptanceCriteria:
  - "Slug function produces lowercase, hyphen-separated names with no special characters or path separators"
  - "Slug is deterministic: the same title always produces the same slug"
  - "Titles exceeding 60 characters are truncated at a word boundary and appended with the first 6 characters of the item ID to guarantee uniqueness"
  - "Collision-avoidance appends a short ID suffix when two siblings produce the same slug without the ID"
  - "Unit tests cover: normal ASCII titles, Unicode characters, all-special-character titles, long titles, and sibling collision cases"
description: "Implement a deterministic slug function that converts PRD item titles into safe, stable directory names (lowercase, hyphens, no special characters, max length). Define truncation and collision-avoidance rules for sibling items that produce the same slug. Apply the convention to all four PRD levels: epics, features, tasks, and subtasks."
---

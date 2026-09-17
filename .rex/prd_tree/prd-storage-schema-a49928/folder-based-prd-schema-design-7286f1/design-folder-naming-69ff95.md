---
id: "69ff9538-093b-45d6-b968-33a46270a048"
level: "task"
title: "Design folder naming conventions, index.md content schema, and recursive summary contract for each PRD level"
status: "completed"
priority: "critical"
tags:
  - "prd"
  - "storage"
  - "design"
source: "smart-add"
startedAt: "2026-04-27T18:47:10.450Z"
completedAt: "2026-04-27T18:52:58.283Z"
endedAt: "2026-04-27T18:52:58.283Z"
acceptanceCriteria:
  - "Naming convention handles unicode, long titles, and slug collisions without ambiguity"
  - "index.md schema is fully specified for epic, feature, and task levels with example output"
  - "Recursive summary block in parent index.md lists all direct children with title and status"
  - "Task-level index.md encodes subtasks as markdown sections rather than nested folders"
  - "Spec is committed to docs/ and linked from CLAUDE.md architecture section"
description: "Produce a written spec covering: directory-naming rules (slugified title + short ID suffix for collision resistance), mandatory fields per level in index.md (title, status, description, acceptance criteria, LoE), and the recursive children-summary block that every non-leaf index.md must include. The spec becomes the contract for serializer and parser implementations and must be committed to docs/ and referenced from CLAUDE.md."
---

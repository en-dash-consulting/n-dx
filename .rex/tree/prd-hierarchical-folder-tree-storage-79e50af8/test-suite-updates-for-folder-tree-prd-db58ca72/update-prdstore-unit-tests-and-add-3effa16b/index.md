---
id: "3effa16b-1466-4b82-a963-c1f21afaedeb"
level: "task"
title: "Update PRDStore unit tests and add serializer/parser unit tests with folder-tree fixtures"
status: "completed"
priority: "high"
tags:
  - "prd"
  - "tests"
  - "unit"
source: "smart-add"
startedAt: "2026-04-28T10:19:31.855Z"
completedAt: "2026-04-28T13:49:34.833Z"
endedAt: "2026-04-28T13:49:34.833Z"
acceptanceCriteria:
  - "All existing PRDStore unit tests pass with the folder-tree backend without modification to test assertions"
  - "Serializer unit tests: create item → correct folder and index.md, edit item → updated index.md and parent summary, delete item → folder removed and parent summary cleaned, move item → folder relocated and both parents updated"
  - "Parser unit tests: known folder fixture → correct item tree, missing index.md → structured warning emitted, malformed frontmatter → partial load with warning"
  - "Round-trip test: serialize known PRD → parse output → assert zero diff from original"
description: "Refactor existing PRDStore unit tests in packages/rex/tests/ to use folder-tree fixtures. Add focused unit tests for the serializer (assert correct folder structure for known PRD input) and parser (assert correct item tree for known folder structure). Assert that parent index.md summary sections are updated after every write."
---

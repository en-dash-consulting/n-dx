---
id: "a063a3c7-f2df-4227-b176-b9f4aed75a84"
level: "task"
title: "Implement LLM-driven rename resolution for conflicting sibling titles"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "llm"
  - "reshape"
source: "smart-add"
acceptanceCriteria:
  - "Title collision with semantically distinct items triggers an LLM rename proposal for both items"
  - "Both items receive titles that reflect their descriptions and remain unique among siblings"
  - "Rename actions are recorded in .rex/archive.json with old/new titles and reasoning"
  - "If the LLM rename fails or produces another collision, the operation fails with a clear error rather than falling back to suffix generation"
  - "Integration test covers the rename path end-to-end with a fixture pair of same-titled, semantically-distinct items"
description: "When a new item would collide with an existing sibling's title and the two items are *not* duplicates (different descriptions/intent), invoke the LLM to propose distinct, descriptive titles for both items based on their full content. Apply the renames atomically and record the rename in the archive audit trail. This replaces the suffix-append fallback for the non-duplicate case."
---

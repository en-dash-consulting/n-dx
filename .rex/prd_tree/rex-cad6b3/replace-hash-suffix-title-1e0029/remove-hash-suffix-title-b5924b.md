---
id: "b5924bd0-ca39-4052-a20a-6f2195fed052"
level: "task"
title: "Remove hash-suffix title disambiguation from rex add and reshape write paths"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "prd-storage"
  - "reshape"
source: "smart-add"
acceptanceCriteria:
  - "rex add and ndx add never produce a title containing a generated hash/id suffix when a duplicate title is encountered"
  - "No code path in the write pipeline calls the suffix-generation helper for new items"
  - "Existing hash-suffix consolidation detection in reshape continues to function for legacy data"
  - "Regression test asserts that adding a duplicate-titled item triggers rename-or-merge resolution rather than suffix generation"
description: "Locate and remove the code path that appends a hash/id suffix to a new item's title when a sibling with the same title already exists. This includes the add pipeline, smart-add, and any reshape pass that generates suffixed titles. The hash-suffix consolidation detector (which identifies *existing* suffixed duplicates for cleanup) must remain — only the *creation* of new suffixed titles is being eliminated."
---

---
id: "1e0029c2-5719-4cef-aae2-61d8400a7d0b"
level: "feature"
title: "Replace Hash-Suffix Title Disambiguation with Rename-or-Merge Resolution"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Currently when rex add encounters a conflicting (duplicate) title, it appends a hash/id suffix to disambiguate (e.g. 'Foo (abc123)'). This pollutes titles with non-semantic noise and defers the real decision. Replace this behavior so that when a title conflict is detected, the system either (a) renames both conflicting items to titles that better reflect their distinct descriptions, or (b) merges them following the existing reshape consolidation rules when they are genuinely duplicates. The hash-suffix addition path must be removed entirely from the add/reshape pipeline."
---

## Children

| Title | Status |
|-------|--------|
| [Implement LLM-driven rename resolution for conflicting sibling titles](./implement-llm-driven-rename-a063a3.md) | completed |
| [Remove hash-suffix title disambiguation from rex add and reshape write paths](./remove-hash-suffix-title-b5924b.md) | pending |
| [Route true title-conflict duplicates through existing reshape merge rules](./route-true-title-conflict-95b5c8.md) | pending |

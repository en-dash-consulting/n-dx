---
id: "d08290fd-0664-4fb9-8881-0974b2879c50"
level: "feature"
title: "Reshape Consolidation of Hash-Suffixed Same-Title Items Under Generated Parent"
status: "completed"
source: "smart-add"
startedAt: "2026-05-18T18:19:02.099Z"
completedAt: "2026-05-18T18:19:02.099Z"
endedAt: "2026-05-18T18:19:02.099Z"
acceptanceCriteria: []
description: "Extend the reshape pipeline so that when multiple sibling PRD items share the same base title differing only by hash suffix (e.g. 'Fix observation in global', 'Fix observation in global-a3f2', 'Fix observation in global-b91c'), they are consolidated under a newly created parent item. The parent inherits the shared base title, and the original children are renamed to distinct, descriptive titles derived from their individual descriptions/bodies via an LLM call. This addresses the proliferation of hash-disambiguated duplicates that currently clutter the PRD tree under epics like Code Health & Dependencies."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:11be7299-0ef9-4b4e-808a-a09e98fe708e","matchedItemId":"11be7299-0ef9-4b4e-808a-a09e98fe708e","matchedItemTitle":"Hash-Suffixed Duplicate Title Consolidation in Reshape","matchedItemLevel":"feature","matchedItemStatus":"completed","createdAt":"2026-05-18T16:00:07.309Z"}
---

## Children

| Title | Status |
|-------|--------|
| [Create generated parent and reparent hash-suffixed children during reshape](./create-generated-parent-and-aa3c7e.md) | completed |
| [Detect groups of hash-suffixed same-base-title siblings in reshape pass](./detect-groups-of-hash-suffixed-cd96c7.md) | completed |
| [LLM-driven rename of consolidated children to descriptive titles](./llm-driven-rename-of-f848f4.md) | completed |

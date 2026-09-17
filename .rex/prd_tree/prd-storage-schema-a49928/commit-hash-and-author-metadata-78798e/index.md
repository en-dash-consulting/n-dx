---
id: "78798ece-882f-44c9-9996-6eec6e909989"
level: "feature"
title: "Commit Hash and Author Metadata on PRD Items"
status: "completed"
source: "smart-add"
startedAt: "2026-04-30T14:27:57.050Z"
completedAt: "2026-04-30T14:27:57.050Z"
endedAt: "2026-04-30T14:27:57.050Z"
acceptanceCriteria: []
description: "Extend each PRD item's markdown frontmatter with structured fields for the full commit hash(es) and author(s) tied to that item. Hench's commit-time status transition (already embedded as a trailer) is the primary write site; the schema must also support manual additions and multi-commit items (an item completed across multiple commits accumulates an array)."
---

## Children

| Title | Status |
|-------|--------|
| [Extend PRD item frontmatter schema and parser/serializer for commit attribution](./extend-prd-item-frontmatter-55f508.md) | completed |
| [Populate commit attribution on hench-driven status transitions and from commit-message trailers](./populate-commit-attribution-on-8956fb.md) | completed |
| [Surface commit attribution in dashboard PRD detail view and folder index summaries](./surface-commit-attribution-in-fa5724.md) | completed |

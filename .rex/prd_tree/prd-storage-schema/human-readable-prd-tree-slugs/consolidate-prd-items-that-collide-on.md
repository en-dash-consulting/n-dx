---
id: "f0ca950b-8ccf-4983-be54-ffa4f99ca4ff"
level: "task"
title: "Consolidate PRD items that collide on a title-only slug"
status: "completed"
priority: "medium"
source: "ndx-capture"
startedAt: "2026-09-01T18:21:47.745Z"
completedAt: "2026-09-01T18:44:41.690Z"
endedAt: "2026-09-01T18:44:41.690Z"
acceptanceCriteria:
  - "No two siblings share a normalised title anywhere in the tree"
  - "Root-level epic count is within the configured threshold"
  - "No PRD item is lost in the consolidation — item count before and after is reconciled explicitly"
description: "127 of 1398 items share a normalised title with a sibling and would collide the moment the id suffix is dropped: 8 groups at root (33 items), 12 at depth 1 (28 items), 21 at depth 2 (66 items). The root collisions are the duplicate epics `ndx status` already warns about — `rex` x6, `web-dashboard` x5, `hench` x4, against a 15-epic threshold with 43 present. These are not an obstacle to route around; the readable-slug work surfaces a structural problem that is worth fixing on its own merits, which is why it is sequenced first. Use `ndx reshape` to merge or re-parent duplicates rather than renaming items to dodge the collision."
lastModified: "2026-09-01T18:44:41.695Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

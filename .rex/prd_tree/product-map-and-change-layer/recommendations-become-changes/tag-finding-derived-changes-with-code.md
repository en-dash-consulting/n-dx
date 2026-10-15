---
id: "eacf9846-3c6c-453d-b014-9bbb446d7874"
level: "task"
title: "Tag finding-derived changes with code-health when recommend or analyze create them"
status: "completed"
priority: "medium"
startedAt: "2026-10-14T19:30:12.887Z"
completedAt: "2026-10-14T19:43:26.425Z"
endedAt: "2026-10-14T19:43:26.425Z"
resolutionType: "code-change"
resolutionDetail: "recommend tags its whole hierarchy code-health; analyze tags finding-derived tasks only (zone features and category epics stay untagged). CODE_HEALTH_TAG exported from core/placement.ts; excluded from epic-title inference in propose.ts."
acceptanceCriteria: []
description: "From the placement review (capture d0e81205, decided 2026-10-08, Ryan). Placement (PR 12 follow-up, task dd0b540e) now treats a change as a code-health finding only when it carries the tag code-health, no longer by source sourcevision. When rex recommend or rex analyze create a change from a sourcevision finding (anti-pattern, structural or tech-debt finding), add the code-health tag; zone features and category epics that rex analyze proposes as new work do not get it. Test both paths."
lastModified: "2026-10-14T19:43:26.717Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

---
id: "eacf9846-3c6c-453d-b014-9bbb446d7874"
level: "task"
title: "Tag finding-derived changes with code-health when recommend or analyze create them"
status: "in_progress"
priority: "medium"
startedAt: "2026-10-14T19:30:12.887Z"
acceptanceCriteria: []
description: "From the placement review (capture d0e81205, decided 2026-10-08, Ryan). Placement (PR 12 follow-up, task dd0b540e) now treats a change as a code-health finding only when it carries the tag code-health, no longer by source sourcevision. When rex recommend or rex analyze create a change from a sourcevision finding (anti-pattern, structural or tech-debt finding), add the code-health tag; zone features and category epics that rex analyze proposes as new work do not get it. Test both paths."
lastModified: "2026-10-14T19:30:13.548Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

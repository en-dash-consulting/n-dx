---
id: "eacf9846-3c6c-453d-b014-9bbb446d7874"
level: "task"
title: "Tag finding-derived changes with code-health when recommend or analyze create them"
status: "pending"
priority: "medium"
description: "From the placement review (capture d0e81205, decided 2026-10-08, Ryan). Placement (PR 12 follow-up, task dd0b540e) now treats a change as a code-health finding only when it carries the tag code-health, no longer by source sourcevision. When rex recommend or rex analyze create a change from a sourcevision finding (anti-pattern, structural or tech-debt finding), add the code-health tag; zone features and category epics that rex analyze proposes as new work do not get it. Test both paths."
lastModified: "2026-10-08T04:54:10.656Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

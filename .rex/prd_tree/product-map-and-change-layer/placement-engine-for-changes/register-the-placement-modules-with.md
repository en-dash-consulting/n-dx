---
id: "5f83d450-be18-4620-9c8b-594745e84457"
level: "task"
title: "Register the placement modules with the v2 isolation test"
status: "completed"
priority: "critical"
startedAt: "2026-10-08T04:55:14.421Z"
completedAt: "2026-10-08T05:01:04.589Z"
endedAt: "2026-10-08T05:01:04.589Z"
acceptanceCriteria: []
description: "Run 2fa34877's gate (run db35fba1) failed only because core/placement.ts now imports a runtime value (ADDED_NODE_TYPES) from schema/v2.ts and the v2 isolation test in packages/rex/tests/unit/schema/v2.test.ts ('no runtime module imports the v2 modules yet') does not list it. Add core/placement.ts and core/placement-policy.ts (which imports placement.ts) to the v2 module set in that test, as PRs 10 and 11 did for their modules, and update the comment that lists the v2 modules. Change nothing else. The full rex suite must pass. Decided 2026-10-08 (Ryan, option a)."
lastModified: "2026-10-08T05:01:05.649Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

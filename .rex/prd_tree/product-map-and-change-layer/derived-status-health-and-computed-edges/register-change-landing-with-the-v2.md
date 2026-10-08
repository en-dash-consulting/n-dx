---
id: "ae3c8475-b3b7-46d0-82f1-dc2675feafde"
level: "task"
title: "Register change-landing with the v2 isolation test, report open changes as not landed, and load landing inputs once"
status: "completed"
priority: "high"
startedAt: "2026-10-08T05:07:27.447Z"
completedAt: "2026-10-08T05:16:52.569Z"
endedAt: "2026-10-08T05:16:52.569Z"
acceptanceCriteria: []
description: "Three fixes after task 52f22b65 (run e3a43f6d, commits 0df9e0fcb and 58903312), decided 2026-10-08 (Ryan). Do all three; this run closes captures b7520479 and 03866a98.\n\n1. Isolation registration (why run e3a43f6d's gate failed). core/change-landing.ts imports indexTree from schema/v2-rules.ts at runtime, so add core/change-landing.ts to the v2 module set in packages/rex/tests/unit/schema/v2.test.ts ('no runtime module imports the v2 modules yet'), and add any other module of this branch that now imports a v2 module at runtime and is missing. Update the comment that lists the v2 modules.\n2. Open changes do not land (capture b7520479, option a). computeLanding reports a landing only for a change that is completed or has appliedAt; for any other change it returns landed: false with the reason 'change still open', and resolveShippedIn returns nothing for it. Test: a change with task 1 merged and tagged and task 2 unmerged is not landed and has no shippedIn.\n3. Load landing inputs once (capture 03866a98). In computeLandings, resolve the main ref, run the shallow check and load the trailer-commit and landing caches once per call, then compute each change with a pure per-change function; keep computeLanding as a thin wrapper. No behaviour change beyond point 2.\n\nThe full rex suite must pass, including the v2 isolation test. Commit the work. Patch changeset for @n-dx/rex."
lastModified: "2026-10-08T05:16:52.793Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

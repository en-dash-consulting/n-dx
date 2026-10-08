---
id: "a646fc0a-0fa3-4b85-9879-a20f1d6fc0d3"
level: "task"
title: "Migration plan turns a version-numbered epic that is not a release into a release umbrella (e.g. \"Python 3.12 support\")"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "rex"
blockedBy:
  - "ab7b00bb-b362-44d9-917f-23fb0f4e85dd"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "classifyV1Tree classifies an epic titled \"Python 3.12 support\" as an area, not a release (test)"
  - "\"ndx 0.9.0\", \"0.6.0 / PR 4 · …\" and \"Release v1.2\" still classify as release or change (test)"
description: "Verdict: should-fix (medium).\n\nScenario: in packages/rex/src/core/migration-plan.ts, `releaseToken` (the RELEASE_TOKEN regex) accepts any dotted number in a title. A v1 epic titled \"Python 3.12 support\" or \"Upgrade to Vitest 4.1\" is classified as a release umbrella. It gets target \"release\", so the area disappears, and every child becomes a change with plannedRelease \"3.12\". Nothing in the plan flags it.\n\nReachability: `classifyV1Tree` on any repository whose epics name dependency or runtime versions. No such epic exists in this repo today. The command isn't wired yet (task 27e4f378).\n\nOptions:\n(a) Recommended: count a version as a release only when it is preceded by the project/product name, \"v\", \"release\" or \"ndx\", or opens the title (e.g. \"0.6.0 / PR 4\"). Cost: small regex change plus tests. Risk: misses unusual release titles. They would then become areas, which the reviewer sees.\n(b) Pass the project's known release versions (git tags or package versions) in as an option and match only those. More accurate, but it needs I/O at the call site.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`: the affected test gate refuses a stale rex dist/ (run 699cd138 failed only on that)."
lastModified: "2026-10-08T20:26:45.789Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

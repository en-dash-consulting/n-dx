---
id: "2b490606-23db-4ec3-8024-78334f1b1a1c"
level: "task"
title: "Layer 4 · Isolation off for unit projects, one package at a time"
status: "completed"
priority: "medium"
source: "ndx-capture"
startedAt: "2026-10-13T22:18:17.376Z"
completedAt: "2026-10-13T22:18:17.376Z"
endedAt: "2026-10-13T22:18:17.376Z"
acceptanceCriteria:
  - "Three consecutive green local runs per package after the change"
  - "web's per-suite wall time on Windows drops by at least a third"
description: "Each package vitest config becomes two test.projects: unit with isolate: false, and isolated holding every file that uses vi.mock, vi.doMock, vi.resetModules or process.chdir, listed as a literal include. Order: web, sourcevision, llm-client, rex, hench. State leaks are fixed in tests, never hidden by moving a file to the isolated project unless it mocks."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-13T22:18:17.666Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

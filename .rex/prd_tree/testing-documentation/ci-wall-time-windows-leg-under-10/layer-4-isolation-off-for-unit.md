---
id: "2b490606-23db-4ec3-8024-78334f1b1a1c"
level: "task"
title: "Layer 4 · Isolation off for unit projects, one package at a time"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "Three consecutive green local runs per package after the change"
  - "web's per-suite wall time on Windows drops by at least a third"
description: "Each package vitest config becomes two test.projects: unit with isolate: false, and isolated holding every file that uses vi.mock, vi.doMock, vi.resetModules or process.chdir, listed as a literal include. Order: web, sourcevision, llm-client, rex, hench. State leaks are fixed in tests, never hidden by moving a file to the isolated project unless it mocks."
lastModified: "2026-10-12T14:52:05.457Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

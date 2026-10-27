---
id: "2b490606-23db-4ec3-8024-78334f1b1a1c"
type: "change"
title: "Layer 4 · Isolation off for unit projects, one package at a time"
slug: "layer-4-isolation-off-for-unit"
intent: "Each package vitest config becomes two test.projects: unit with isolate: false, and isolated holding every file that uses vi.mock, vi.doMock, vi.resetModules or process.chdir, listed as a literal include. Order: web, sourcevision, llm-client, rex, hench. State leaks are fixed in tests, never hidden by moving a file to the isolated project unless it mocks."
acceptanceCriteria:
  - "Three consecutive green local runs per package after the change"
  - "web's per-suite wall time on Windows drops by at least a third"
touches:
  - "4d39b5b0-fd9d-45ad-a510-30551d185556"
priority: "medium"
source: "ndx-capture"
---

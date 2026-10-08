---
id: "abd05895-1b96-4798-bfb8-8e4b66fca049"
level: "feature"
title: "v2 store transaction for the product and change layers"
status: "completed"
priority: "high"
tags:
  - "product-map"
  - "pr-31"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
blockedBy:
  - "16a680ad-40ec-43d6-a8ea-2eedbc3e0e77"
source: "roadmap"
startedAt: "2026-10-08T21:47:42.790Z"
completedAt: "2026-10-08T21:47:42.790Z"
endedAt: "2026-10-08T21:47:42.790Z"
acceptanceCriteria: []
description: "A store API that takes the PRD lock, loads the v2 product and change layers, runs the caller's mutation and writes the result, refusing a v1 tree. PRs 16, 10 and 11 left v2 logic pure (it returns a new tree and writes nothing); this is the write path PR 17 (MCP) and PR 18 (CLI) both need. Its own PR from main, ahead of PR 17 (decided 2026-10-08). Run with claude-opus-5-5 for run and review.\n\nRoadmap PR 31 · wave 2 · lane rex-store."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-08T21:47:43.087Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a v2 store transaction that loads and writes the product and change layers under the PRD lock](./add-a-v2-store-transaction-that-loads.md) | completed |
| [Add the v2 store transaction to the v2 isolation test's module set](./add-the-v2-store-transaction-to-the-v2.md) | completed |
| [v2 isolation test does not detect imports of the store transaction from outside the v2 set](./v2-isolation-test-does-not-detect.md) | completed |

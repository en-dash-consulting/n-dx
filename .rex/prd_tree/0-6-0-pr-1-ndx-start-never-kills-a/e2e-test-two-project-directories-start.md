---
id: "7bc1bb3d-e981-4384-a103-d75c974f190a"
level: "task"
title: "E2E test: two project directories start dashboards concurrently without killing each other"
status: "pending"
priority: "high"
tags:
  - "pr-01"
  - "core"
  - "tests"
blockedBy:
  - "a9a2090c-a298-4188-a9e6-5c910ce09a28"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "New e2e test passes locally and in CI on macOS and Linux runners."
  - "The test leaves no orphaned server processes when it fails."
description: "Add tests/e2e/cli-start-two-projects.test.js modelled on tests/e2e/mcp-transport.test.js (which already spawns `node <cli> start --port=<p> <tmpDir>`). Create two initialized temp projects, start A on a chosen port, start B with the same requested port, assert: A still answers /api/status, B answers on a different port, B's stdout names the fallback, and `start stop` on each directory stops only its own server. Clean up processes in afterAll even on failure (use terminateTreeByPid from packages/core/child-lifecycle.js)."
lastModified: "2026-09-10T20:11:34.485Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

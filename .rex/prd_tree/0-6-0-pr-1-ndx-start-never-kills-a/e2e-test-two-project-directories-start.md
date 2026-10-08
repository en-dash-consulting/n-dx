---
id: "7bc1bb3d-e981-4384-a103-d75c974f190a"
level: "feature"
title: "E2E test: two project directories start dashboards concurrently without killing each other"
status: "completed"
priority: "high"
tags:
  - "pr-01"
  - "core"
  - "tests"
blockedBy:
  - "a9a2090c-a298-4188-a9e6-5c910ce09a28"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T01:43:04.351Z"
completedAt: "2026-09-11T01:58:06.924Z"
endedAt: "2026-09-11T01:58:06.924Z"
acceptanceCriteria:
  - "New e2e test passes locally and in CI on macOS and Linux runners."
  - "The test leaves no orphaned server processes when it fails."
description: "Add tests/e2e/cli-start-two-projects.test.js modelled on tests/e2e/mcp-transport.test.js (which already spawns `node <cli> start --port=<p> <tmpDir>`). Create two initialized temp projects, start A on a chosen port, start B with the same requested port, assert: A still answers /api/status, B answers on a different port, B's stdout names the fallback, and `start stop` on each directory stops only its own server. Clean up processes in afterAll even on failure (use terminateTreeByPid from packages/core/child-lifecycle.js)."
commits:
  - {"hash":"2a3028b436d836839c148a85a71819cf00fd925d","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T11:02:46-07:00"}
  - {"hash":"94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T17:27:39-04:00"}
  - {"hash":"ab8dccd9fadf527a84085f079b245dbdb2dc8ce2","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T15:13:33-07:00"}
  - {"hash":"25d7aa662c414e831fc41dbfc259db94782e0bda","author":"ryrykeith","authorEmail":"109387558+ryrykeith@users.noreply.github.com","timestamp":"2026-09-11T23:59:49-04:00"}
lastModified: "2026-09-11T01:58:06.932Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

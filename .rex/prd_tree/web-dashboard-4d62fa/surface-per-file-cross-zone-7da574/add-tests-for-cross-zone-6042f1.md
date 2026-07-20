---
id: "6042f156-002f-4dc3-a023-4c60f006f3c5"
level: "task"
title: "Add tests for cross-zone connection surfacing and file ordering"
status: "completed"
priority: "medium"
blockedBy:
  - "03fd3c35-f82f-4939-9b63-09e97ff86ecc"
  - "f9c64896-b533-4502-a73d-94a7de09db1e"
startedAt: "2026-07-20T17:02:08.407Z"
completedAt: "2026-07-20T20:45:35.232Z"
endedAt: "2026-07-20T20:45:35.232Z"
resolutionType: "code-change"
resolutionDetail: "Added 9 unit tests for buildFileConnectionMap in packages/web/tests/unit/viewer/zone-connecting-files.test.ts (call-edge bidirectional connections + weight accumulation, same-zone/unresolved/unzoned exclusions, external-import zone mapping incl. @n-dx/ scope, bare names, src/ preference, same-zone skip, combined call+import weights). Exported buildFileConnectionMap from viewer/views/zones.ts for testability. Ordering and connecting-only-filter criteria were already covered by the 18 existing tests from the blocker commits."
acceptanceCriteria: []
description: "Unit tests covering the Zones graph cross-zone connection surfacing work: buildFileConnectionMap target/weight correctness, file-row ordering (connecting files sorted ahead of internal-only), and the connecting-only filter. Live under packages/web/tests/. Acceptance criteria: (1) Test verifies connecting files sort ahead of internal-only files in an expanded zone. (2) Test verifies the connecting-only filter hides internal-only files. (3) Test verifies target-zone labels resolve to real zone names and weights from fileConnections."
---

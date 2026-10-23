---
id: "6042f156-002f-4dc3-a023-4c60f006f3c5"
type: "change"
title: "Add tests for cross-zone connection surfacing and file ordering"
slug: "add-tests-for-cross-zone-connection"
intent: "Unit tests covering the Zones graph cross-zone connection surfacing work: buildFileConnectionMap target/weight correctness, file-row ordering (connecting files sorted ahead of internal-only), and the connecting-only filter. Live under packages/web/tests/. Acceptance criteria: (1) Test verifies connecting files sort ahead of internal-only files in an expanded zone. (2) Test verifies the connecting-only filter hides internal-only files. (3) Test verifies target-zone labels resolve to real zone names and weights from fileConnections."
amends: [{"target":"7da57492-972c-4244-bf1e-fe72f37a16e0","delta":"modified","summary":"Add tests for cross-zone connection surfacing and file ordering","base":"f66267daab7f127c8685ac48e476978c16c26152392b592357f15aa3fe25dd5a"}]
priority: "medium"
blockedBy:
  - "03fd3c35-f82f-4939-9b63-09e97ff86ecc"
  - "f9c64896-b533-4502-a73d-94a7de09db1e"
---

---
id: "82784841-557f-4bc6-bde9-c17cd0f35bbd"
level: "task"
title: "OPEN_SOURCE_SCOPE.md's package table can drift from the published packages again"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A root test fails naming any non-private packages/* package missing from OPEN_SOURCE_SCOPE.md's Included components table"
  - "The same test fails when a row's License column differs from that package.json's license field, or a row names a package that is private or absent"
description: "Verdict: should-fix (low). Found by the adversarial review of 6f6a9102. That task added the nine missing packages to the Included components table in OPEN_SOURCE_SCOPE.md (around lines 27-44), but nothing checks the table. Scenario: someone adds packages/lang-rust (published, Elastic-2.0) to packages/* and the fixed group. fixed-group-versions.test.js passes, and the table quietly leaves out a published package again, which is the exact drift 0808fbc1 reported. Reachable whenever a package is added. Options: (a) Recommended: add a root e2e test that parses the table's npm-name and License columns and checks them against every non-private packages/*/package.json (name and license both match, no extra rows). It costs about 30 lines, and its only risk is a brittle markdown parse; keep it to the one table. (b) Drop the table in favour of a pointer. This loses the per-package license column that licensing readers want."
lastModified: "2026-10-17T10:38:04.139Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

---
id: "e093ac5d-ac9b-4a2a-bcec-e8d8094f9316"
level: "task"
title: "Turn the .n-dx* ratchet into a wall"
status: "completed"
priority: "medium"
tags:
  - "pr-29"
  - "lane-models-analysis"
blockedBy:
  - "66397a69-5347-4659-8852-4ff1724ae261"
source: "roadmap"
startedAt: "2026-10-08T15:40:33.927Z"
completedAt: "2026-10-08T15:56:03.661Z"
endedAt: "2026-10-08T15:56:03.661Z"
acceptanceCriteria:
  - "A new .n-dx* literal anywhere outside ALLOWED fails the policy test with file and line (test)"
  - "The inventory file no longer carries a ratchet count"
description: "Once the inventory is empty, make tests/e2e/layout-literal-policy.test.js treat .n-dx* literals the way it already treats .rex/, .hench/ and .sourcevision/: any site outside ALLOWED fails with its file and line. Retire tests/layout-literal-inventory.md's ratchet table (or reduce it to the ALLOWED explanation)."
lastModified: "2026-10-08T15:56:05.732Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

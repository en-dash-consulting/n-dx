---
id: "d9da43a9-519e-4369-ae4c-c86b41a00116"
level: "task"
title: "Any website the user has open can make the dashboard spawn ndx processes through the prep and ready GETs"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web-server"
  - "security"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "GET /api/hench/prep/:taskId and /api/hench/ready answer 403 to requests with Sec-Fetch-Site: cross-site; same-origin and header-less CLI requests still work (tests)."
  - "Concurrent prep requests beyond a small cap are refused or coalesced, and a client disconnect kills the spawned child (tests)."
description: "Verdict: should-fix (local resource abuse; responses are not readable cross-origin).\n\nScenario: a page fires <img src=\"http://localhost:3117/api/hench/prep/x\"> in a loop. Safe methods pass request-security.ts:100-115 whenever Host is loopback; each request spawns ndx then hench (up to 15 s), with no concurrency cap and no kill on client disconnect (routes-hench-prep.ts:184, :258). The same loop against /ready?limit=50 stacks event-loop stalls.\n\nFix (recommended): reject Sec-Fetch-Site: cross-site (and a foreign Origin) on spawn-backed GETs; cap in-flight prep/preview spawns per server (dedupe by taskId); kill the child on req 'close'."
lastModified: "2026-10-02T07:47:39.724Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

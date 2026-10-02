---
id: "228f060a-3767-4acc-b1cd-489a6ee17f7c"
level: "task"
title: "GET /api/hench/ready?limit=1e9 returns one row instead of the maximum"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-server"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "limit=1e9 returns up to 50 rows, '10abc' and 'abc' use the default, and 0 or negative values clamp to 1; tests cover each."
description: "Verdict: should-fix (cheap).\n\nScenario: readyLimit (routes-hench-prep.ts:252) uses parseInt, so '1e9' → 1, '10abc' → 10, and 0 or negatives become 1. Fix (recommended): Number(raw), require Number.isInteger, clamp to 1..50, fall back to the default for anything else."
lastModified: "2026-10-02T07:47:52.488Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

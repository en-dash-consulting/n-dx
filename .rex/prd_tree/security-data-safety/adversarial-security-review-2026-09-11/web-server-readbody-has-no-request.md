---
id: "f80187ac-090f-4f50-b7d6-c869cdc4abca"
level: "task"
title: "Web server `readBody` has no request-size cap"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "security"
  - "severity:low"
  - "web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`readBody` rejects (and the route responds 413) when the body exceeds the configured cap"
  - "The cap is a named constant with a comment stating the largest legitimate payload it must admit"
  - "Unit test posts a body one byte over the cap and asserts 413 and that the connection is closed"
description: "**Severity:** low · **Verdict:** should-fix\n\n**Failure scenario.** `readBody` concatenates every `data` chunk with no limit (`response-utils.ts:30-37`). Any local process — or a same-origin page — can POST a multi-gigabyte body to any JSON route and drive the dashboard server out of memory. Cross-origin POSTs are rejected by the Origin guard before the route runs, but the body may still be buffered by Node before `res.end()` closes the socket, depending on timing. Loopback-only, so this is availability of the local dashboard, not data.\n\n**Evidence.** `packages/web/src/server/response-utils.ts:30-37`.\n\n**Reachability.** Local processes and same-origin pages only.\n\n**Solution.** Cap at a constant (e.g. 10 MB — the largest legitimate body is a PRD bundle import), destroy the request and respond 413 when exceeded. Trivial."
lastModified: "2026-09-11T17:38:09.291Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
